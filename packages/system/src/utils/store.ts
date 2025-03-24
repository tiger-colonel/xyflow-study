import { HandleConnection, infiniteExtent } from '..';
import {
  NodeBase,
  CoordinateExtent,
  InternalNodeUpdate,
  NodeOrigin,
  PanZoomInstance,
  Transform,
  XYPosition,
  ConnectionLookup,
  EdgeBase,
  EdgeLookup,
  InternalNodeBase,
  NodeLookup,
  Rect,
  NodeDimensionChange,
  NodePositionChange,
  ParentLookup,
} from '../types';
import { getDimensions, getHandleBounds } from './dom';
import {
  clampPosition,
  clampPositionToParent,
  getBoundsOfRects,
  getNodeDimensions,
  isCoordinateExtent,
  isNumeric,
  nodeToRect,
} from './general';
import { getNodePositionWithOrigin } from './graph';
import { ParentExpandChild } from './types';

const defaultOptions = {
  nodeOrigin: [0, 0] as NodeOrigin,
  nodeExtent: infiniteExtent,
  elevateNodesOnSelect: true,
  defaults: {},
};

const adoptUserNodesDefaultOptions = {
  ...defaultOptions,
  checkEquality: true,
};

function mergeObjects<T extends Record<string, unknown>>(base: T, incoming?: Partial<T>): T {
  const result = { ...base };
  for (const key in incoming) {
    if (incoming[key] !== undefined) {
      // 这里的类型转换是安全的，因为我们检查了undefined
      result[key] = (incoming as T)[key]!;
    }
  }

  return result;
}

export function updateAbsolutePositions<NodeType extends NodeBase>(
  nodeLookup: NodeLookup<InternalNodeBase<NodeType>>,
  parentLookup: ParentLookup<InternalNodeBase<NodeType>>,
  options?: UpdateNodesOptions<NodeType>
) {
  const _options = mergeObjects(defaultOptions, options);
  for (const node of nodeLookup.values()) {
    if (node.parentId) {
      updateChildNode(node, nodeLookup, parentLookup, _options);
    } else {
      const positionWithOrigin = getNodePositionWithOrigin(node, _options.nodeOrigin);
      const extent = isCoordinateExtent(node.extent) ? node.extent : _options.nodeExtent;
      const clampedPosition = clampPosition(positionWithOrigin, extent, getNodeDimensions(node));
      node.internals.positionAbsolute = clampedPosition;
    }
  }
}

type UpdateNodesOptions<NodeType extends NodeBase> = {
  nodeOrigin?: NodeOrigin;
  nodeExtent?: CoordinateExtent;
  elevateNodesOnSelect?: boolean;
  defaults?: Partial<NodeType>;
  checkEquality?: boolean;
};

export function adoptUserNodes<NodeType extends NodeBase>(
  nodes: NodeType[],
  nodeLookup: NodeLookup<InternalNodeBase<NodeType>>,
  parentLookup: ParentLookup<InternalNodeBase<NodeType>>,
  options?: UpdateNodesOptions<NodeType>
) {
  const _options = mergeObjects(adoptUserNodesDefaultOptions, options);

  const tmpLookup = new Map(nodeLookup);
  const selectedNodeZ: number = _options?.elevateNodesOnSelect ? 1000 : 0;

  nodeLookup.clear();
  parentLookup.clear();

  for (const userNode of nodes) {
    let internalNode = tmpLookup.get(userNode.id);

    if (_options.checkEquality && userNode === internalNode?.internals.userNode) {
      nodeLookup.set(userNode.id, internalNode);
    } else {
      const positionWithOrigin = getNodePositionWithOrigin(userNode, _options.nodeOrigin);
      const extent = isCoordinateExtent(userNode.extent) ? userNode.extent : _options.nodeExtent;
      const clampedPosition = clampPosition(positionWithOrigin, extent, getNodeDimensions(userNode));

      internalNode = {
        ..._options.defaults,
        ...userNode,
        measured: {
          width: userNode.measured?.width,
          height: userNode.measured?.height,
        },
        internals: {
          positionAbsolute: clampedPosition,
          // 如果用户重新初始化节点或者由于某种原因移除了`measured`，我们重置handleBounds，以便节点被重新测量
          handleBounds: !userNode.measured ? undefined : internalNode?.internals.handleBounds,
          z: calculateZ(userNode, selectedNodeZ),
          userNode,
        },
      };

      nodeLookup.set(userNode.id, internalNode);
    }

    if (userNode.parentId) {
      updateChildNode(internalNode, nodeLookup, parentLookup, options);
    }
  }
}

function updateParentLookup<NodeType extends NodeBase>(
  node: InternalNodeBase<NodeType>,
  parentLookup: ParentLookup<InternalNodeBase<NodeType>>
) {
  if (!node.parentId) {
    return;
  }

  const childNodes = parentLookup.get(node.parentId);

  if (childNodes) {
    childNodes.set(node.id, node);
  } else {
    parentLookup.set(node.parentId, new Map([[node.id, node]]));
  }
}

/**
 * 更新子节点的positionAbsolute和zIndex以及parentLookup。
 */
function updateChildNode<NodeType extends NodeBase>(
  node: InternalNodeBase<NodeType>,
  nodeLookup: NodeLookup<InternalNodeBase<NodeType>>,
  parentLookup: ParentLookup<InternalNodeBase<NodeType>>,
  options?: UpdateNodesOptions<NodeType>
) {
  const { elevateNodesOnSelect, nodeOrigin, nodeExtent } = mergeObjects(defaultOptions, options);
  const parentId = node.parentId!;
  const parentNode = nodeLookup.get(parentId);

  if (!parentNode) {
    console.warn(`父节点 ${parentId} 未找到。请确保父节点在节点数组中位于其子节点之前。`);
    return;
  }

  updateParentLookup(node, parentLookup);

  const selectedNodeZ = elevateNodesOnSelect ? 1000 : 0;
  const { x, y, z } = calculateChildXYZ(node, parentNode, nodeOrigin, nodeExtent, selectedNodeZ);
  const { positionAbsolute } = node.internals;
  const positionChanged = x !== positionAbsolute.x || y !== positionAbsolute.y;

  if (positionChanged || z !== node.internals.z) {
    // 我们创建一个新对象来标记节点已更新
    nodeLookup.set(node.id, {
      ...node,
      internals: {
        ...node.internals,
        positionAbsolute: positionChanged ? { x, y } : positionAbsolute,
        z,
      },
    });
  }
}

function calculateZ(node: NodeBase, selectedNodeZ: number) {
  return (isNumeric(node.zIndex) ? node.zIndex : 0) + (node.selected ? selectedNodeZ : 0);
}

function calculateChildXYZ<NodeType extends NodeBase>(
  childNode: InternalNodeBase<NodeType>,
  parentNode: InternalNodeBase<NodeType>,
  nodeOrigin: NodeOrigin,
  nodeExtent: CoordinateExtent,
  selectedNodeZ: number
) {
  const { x: parentX, y: parentY } = parentNode.internals.positionAbsolute;
  const childDimensions = getNodeDimensions(childNode);
  const positionWithOrigin = getNodePositionWithOrigin(childNode, nodeOrigin);
  const clampedPosition = isCoordinateExtent(childNode.extent)
    ? clampPosition(positionWithOrigin, childNode.extent, childDimensions)
    : positionWithOrigin;

  let absolutePosition = clampPosition(
    { x: parentX + clampedPosition.x, y: parentY + clampedPosition.y },
    nodeExtent,
    childDimensions
  );

  if (childNode.extent === 'parent') {
    absolutePosition = clampPositionToParent(absolutePosition, childDimensions, parentNode);
  }

  const childZ = calculateZ(childNode, selectedNodeZ);
  const parentZ = parentNode.internals.z ?? 0;

  return {
    x: absolutePosition.x,
    y: absolutePosition.y,
    z: parentZ > childZ ? parentZ : childZ,
  };
}

export function handleExpandParent(
  children: ParentExpandChild[],
  nodeLookup: NodeLookup,
  parentLookup: ParentLookup,
  nodeOrigin: NodeOrigin = [0, 0]
): (NodeDimensionChange | NodePositionChange)[] {
  const changes: (NodeDimensionChange | NodePositionChange)[] = [];
  const parentExpansions = new Map<string, { expandedRect: Rect; parent: InternalNodeBase }>();

  // 确定每个父节点的子节点会占用的扩展矩形
  for (const child of children) {
    const parent = nodeLookup.get(child.parentId);
    if (!parent) {
      continue;
    }

    const parentRect = parentExpansions.get(child.parentId)?.expandedRect ?? nodeToRect(parent);
    const expandedRect = getBoundsOfRects(parentRect, child.rect);

    parentExpansions.set(child.parentId, { expandedRect, parent });
  }

  if (parentExpansions.size > 0) {
    parentExpansions.forEach(({ expandedRect, parent }, parentId) => {
      // 确定父节点的位置和尺寸
      const positionAbsolute = parent.internals.positionAbsolute;
      const dimensions = getNodeDimensions(parent);
      const origin = parent.origin ?? nodeOrigin;

      // 确定父节点在宽度和位置上的扩展量
      const xChange =
        expandedRect.x < positionAbsolute.x ? Math.round(Math.abs(positionAbsolute.x - expandedRect.x)) : 0;
      const yChange =
        expandedRect.y < positionAbsolute.y ? Math.round(Math.abs(positionAbsolute.y - expandedRect.y)) : 0;

      const newWidth = Math.max(dimensions.width, Math.round(expandedRect.width));
      const newHeight = Math.max(dimensions.height, Math.round(expandedRect.height));

      const widthChange = (newWidth - dimensions.width) * origin[0];
      const heightChange = (newHeight - dimensions.height) * origin[1];

      // 如果原点不是[0,0]，我们需要修正父节点的位置
      if (xChange > 0 || yChange > 0 || widthChange || heightChange) {
        changes.push({
          id: parentId,
          type: 'position',
          position: {
            x: parent.position.x - xChange + widthChange,
            y: parent.position.y - yChange + heightChange,
          },
        });

        /*
         * 我们将所有子节点向相反方向移动
         * 这样父节点的x,y变化不会移动子节点
         */
        parentLookup.get(parentId)?.forEach((childNode) => {
          if (!children.some((child) => child.id === childNode.id)) {
            changes.push({
              id: childNode.id,
              type: 'position',
              position: {
                x: childNode.position.x + xChange,
                y: childNode.position.y + yChange,
              },
            });
          }
        });
      }

      // 如果原点不是[0,0]，我们需要修正父节点的尺寸
      if (dimensions.width < expandedRect.width || dimensions.height < expandedRect.height || xChange || yChange) {
        changes.push({
          id: parentId,
          type: 'dimensions',
          setAttributes: true,
          dimensions: {
            width: newWidth + (xChange ? origin[0] * xChange - widthChange : 0),
            height: newHeight + (yChange ? origin[1] * yChange - heightChange : 0),
          },
        });
      }
    });
  }

  return changes;
}

export function updateNodeInternals<NodeType extends InternalNodeBase>(
  updates: Map<string, InternalNodeUpdate>,
  nodeLookup: NodeLookup<NodeType>,
  parentLookup: ParentLookup<NodeType>,
  domNode: HTMLElement | null,
  nodeOrigin?: NodeOrigin,
  nodeExtent?: CoordinateExtent
): { changes: (NodeDimensionChange | NodePositionChange)[]; updatedInternals: boolean } {
  const viewportNode = domNode?.querySelector('.xyflow__viewport');
  let updatedInternals = false;

  if (!viewportNode) {
    return { changes: [], updatedInternals };
  }

  const changes: (NodeDimensionChange | NodePositionChange)[] = [];
  const style = window.getComputedStyle(viewportNode);
  const { m22: zoom } = new window.DOMMatrixReadOnly(style.transform);
  // 在这个数组中，我们收集可能触发变化的节点（比如扩展父节点）
  const parentExpandChildren: ParentExpandChild[] = [];

  for (const update of updates.values()) {
    const node = nodeLookup.get(update.id);
    if (!node) {
      continue;
    }

    if (node.hidden) {
      nodeLookup.set(node.id, {
        ...node,
        internals: {
          ...node.internals,
          handleBounds: undefined,
        },
      });
      updatedInternals = true;
      continue;
    }

    const dimensions = getDimensions(update.nodeElement);
    const dimensionChanged = node.measured.width !== dimensions.width || node.measured.height !== dimensions.height;
    const doUpdate = !!(
      dimensions.width &&
      dimensions.height &&
      (dimensionChanged || !node.internals.handleBounds || update.force)
    );

    if (doUpdate) {
      const nodeBounds = update.nodeElement.getBoundingClientRect();
      const extent = isCoordinateExtent(node.extent) ? node.extent : nodeExtent;
      let { positionAbsolute } = node.internals;

      if (node.parentId && node.extent === 'parent') {
        positionAbsolute = clampPositionToParent(positionAbsolute, dimensions, nodeLookup.get(node.parentId)!);
      } else if (extent) {
        positionAbsolute = clampPosition(positionAbsolute, extent, dimensions);
      }

      const newNode = {
        ...node,
        measured: dimensions,
        internals: {
          ...node.internals,
          positionAbsolute,
          handleBounds: {
            source: getHandleBounds('source', update.nodeElement, nodeBounds, zoom, node.id),
            target: getHandleBounds('target', update.nodeElement, nodeBounds, zoom, node.id),
          },
        },
      };

      nodeLookup.set(node.id, newNode);

      if (node.parentId) {
        updateChildNode(newNode, nodeLookup, parentLookup, { nodeOrigin });
      }

      updatedInternals = true;

      if (dimensionChanged) {
        changes.push({
          id: node.id,
          type: 'dimensions',
          dimensions,
        });

        if (node.expandParent && node.parentId) {
          parentExpandChildren.push({
            id: node.id,
            parentId: node.parentId,
            rect: nodeToRect(newNode, nodeOrigin),
          });
        }
      }
    }
  }

  if (parentExpandChildren.length > 0) {
    const parentExpandChanges = handleExpandParent(parentExpandChildren, nodeLookup, parentLookup, nodeOrigin);
    changes.push(...parentExpandChanges);
  }

  return { changes, updatedInternals };
}

export async function panBy({
  delta,
  panZoom,
  transform,
  translateExtent,
  width,
  height,
}: {
  delta: XYPosition;
  panZoom: PanZoomInstance | null;
  transform: Transform;
  translateExtent: CoordinateExtent;
  width: number;
  height: number;
}): Promise<boolean> {
  if (!panZoom || (!delta.x && !delta.y)) {
    return Promise.resolve(false);
  }

  const nextViewport = await panZoom.setViewportConstrained(
    {
      x: transform[0] + delta.x,
      y: transform[1] + delta.y,
      zoom: transform[2],
    },
    [
      [0, 0],
      [width, height],
    ],
    translateExtent
  );

  const transformChanged =
    !!nextViewport &&
    (nextViewport.x !== transform[0] || nextViewport.y !== transform[1] || nextViewport.k !== transform[2]);

  return Promise.resolve(transformChanged);
}

/**
 * 此函数将连接添加到connectionLookup中
 * 添加到以下键: nodeId-type-handleId, nodeId-type 和 nodeId
 * @param type 连接类型
 * @param connection 需要添加到查找表的连接
 * @param connectionKey 连接应该添加到的键
 * @param connectionLookup 连接查找表的引用
 * @param nodeId 连接的节点ID
 * @param handleId 连接的句柄ID
 */
function addConnectionToLookup(
  type: 'source' | 'target',
  connection: HandleConnection,
  connectionKey: string,
  connectionLookup: ConnectionLookup,
  nodeId: string,
  handleId: string | null
) {
  /*
   * 我们将连接添加到connectionLookup的以下键中：
   * 1. nodeId, 2. nodeId-type, 3. nodeId-type-handleId
   * 如果键已存在，我们将连接添加到现有的映射中
   */
  let key = nodeId;
  const nodeMap = connectionLookup.get(key) || new Map();
  connectionLookup.set(key, nodeMap.set(connectionKey, connection));

  key = `${nodeId}-${type}`;
  const typeMap = connectionLookup.get(key) || new Map();
  connectionLookup.set(key, typeMap.set(connectionKey, connection));

  if (handleId) {
    key = `${nodeId}-${type}-${handleId}`;
    const handleMap = connectionLookup.get(key) || new Map();
    connectionLookup.set(key, handleMap.set(connectionKey, connection));
  }
}

export function updateConnectionLookup(connectionLookup: ConnectionLookup, edgeLookup: EdgeLookup, edges: EdgeBase[]) {
  connectionLookup.clear();
  edgeLookup.clear();

  for (const edge of edges) {
    const { source: sourceNode, target: targetNode, sourceHandle = null, targetHandle = null } = edge;

    const connection = { edgeId: edge.id, source: sourceNode, target: targetNode, sourceHandle, targetHandle };
    const sourceKey = `${sourceNode}-${sourceHandle}--${targetNode}-${targetHandle}`;
    const targetKey = `${targetNode}-${targetHandle}--${sourceNode}-${sourceHandle}`;

    addConnectionToLookup('source', connection, targetKey, connectionLookup, sourceNode, sourceHandle);
    addConnectionToLookup('target', connection, sourceKey, connectionLookup, targetNode, targetHandle);

    edgeLookup.set(edge.id, edge);
  }
}
