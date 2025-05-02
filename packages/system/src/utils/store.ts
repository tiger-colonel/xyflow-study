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

// 对新节点进行处理，转换为内部表示格式
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

  // 处理每个用户节点
  for (const userNode of nodes) {
    let internalNode = tmpLookup.get(userNode.id);

    if (_options.checkEquality && userNode === internalNode?.internals.userNode) {
      nodeLookup.set(userNode.id, internalNode);
    } else {
      const positionWithOrigin = getNodePositionWithOrigin(userNode, _options.nodeOrigin);
      const extent = isCoordinateExtent(userNode.extent) ? userNode.extent : _options.nodeExtent;
      const clampedPosition = clampPosition(positionWithOrigin, extent, getNodeDimensions(userNode));

      // / 创建或更新内部节点
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

    // 计算节点位置和处理父子关系
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

  // 更新父子关系映射表
  updateParentLookup(node, parentLookup);

  const selectedNodeZ = elevateNodesOnSelect ? 1000 : 0;
  // 计算子节点相对于父节点的绝对位置和Z轴值
  const { x, y, z } = calculateChildXYZ(node, parentNode, nodeOrigin, nodeExtent, selectedNodeZ);
  // 获取当前节点的绝对位置
  const { positionAbsolute } = node.internals;
  const positionChanged = x !== positionAbsolute.x || y !== positionAbsolute.y;

  if (positionChanged || z !== node.internals.z) {
    // 创建一个新对象以确保引用变化，这样React可以检测到更新
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
  // 节点原点配置，影响节点渲染位置
  nodeOrigin: NodeOrigin,
  // 节点可移动范围
  nodeExtent: CoordinateExtent,
  selectedNodeZ: number
) {
  // 获取父节点的绝对位置
  const { x: parentX, y: parentY } = parentNode.internals.positionAbsolute;
  // 获取子节点的尺寸信息（宽高）
  const childDimensions = getNodeDimensions(childNode);
  // 根据节点原点调整位置
  const positionWithOrigin = getNodePositionWithOrigin(childNode, nodeOrigin);
  // 根据子节点的extent约束，限制子节点的相对位置
  const clampedPosition = isCoordinateExtent(childNode.extent)
    ? clampPosition(positionWithOrigin, childNode.extent, childDimensions)
    : positionWithOrigin;

  // 计算子节点绝对位置（父节点位置+子节点相对位置）并应用全局约束
  let absolutePosition = clampPosition(
    { x: parentX + clampedPosition.x, y: parentY + clampedPosition.y },
    nodeExtent,
    childDimensions
  );

  // 如果子节点设置为在父节点范围内约束，则应用父节点边界限制
  if (childNode.extent === 'parent') {
    absolutePosition = clampPositionToParent(absolutePosition, childDimensions, parentNode);
  }

  // 计算子节点的Z轴值（基本Z轴+选中状态提升）
  const childZ = calculateZ(childNode, selectedNodeZ);
  // 获取父节点Z轴值，如不存在则默认为0
  const parentZ = parentNode.internals.z ?? 0;

  // 返回计算结果，z值取父子节点中较大值以确保子节点至少与父节点同层
  return {
    x: absolutePosition.x,
    y: absolutePosition.y,
    z: parentZ > childZ ? parentZ : childZ,
  };
}

// 1. 自适应布局：子节点尺寸变化时，父节点自动调整大小
// 2. 防止内容溢出：确保所有子节点都能完全显示在父节点内
// 3. 复杂嵌套结构：处理多层级节点嵌套的尺寸和位置关系
// 4. 交互式调整：用户拖动或调整节点大小时动态更新父节点
export function handleExpandParent(
  children: ParentExpandChild[],
  nodeLookup: NodeLookup,
  parentLookup: ParentLookup,
  nodeOrigin: NodeOrigin = [0, 0]
): (NodeDimensionChange | NodePositionChange)[] {
  const changes: (NodeDimensionChange | NodePositionChange)[] = [];
  // 存储每个父节点及其扩展后的矩形信息
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

  // 如果有父节点需要扩展
  if (parentExpansions.size > 0) {
    // 遍历每个需要扩展的父节点
    parentExpansions.forEach(({ expandedRect, parent }, parentId) => {
      // 获取父节点的当前位置和尺寸信息
      const positionAbsolute = parent.internals.positionAbsolute;
      const dimensions = getNodeDimensions(parent);
      const origin = parent.origin ?? nodeOrigin;

      // 确定父节点在宽度和位置上的扩展量（当扩展区域超出父节点左、上边界时）
      const xChange =
        expandedRect.x < positionAbsolute.x ? Math.round(Math.abs(positionAbsolute.x - expandedRect.x)) : 0;
      const yChange =
        expandedRect.y < positionAbsolute.y ? Math.round(Math.abs(positionAbsolute.y - expandedRect.y)) : 0;

      // 计算新的宽度和高度，确保能够容纳子节点
      const newWidth = Math.max(dimensions.width, Math.round(expandedRect.width));
      const newHeight = Math.max(dimensions.height, Math.round(expandedRect.height));

      // 根据节点原点计算宽度和高度变化对位置的影响
      const widthChange = (newWidth - dimensions.width) * origin[0];
      const heightChange = (newHeight - dimensions.height) * origin[1];

      // 如果原点不是[0,0]，我们需要修正父节点的位置
      if (xChange > 0 || yChange > 0 || widthChange || heightChange) {
        changes.push({
          id: parentId,
          type: 'position',
          position: {
            // 计算新位置：当扩展左边/上边时减少x/y值，同时考虑原点位置的影响
            x: parent.position.x - xChange + widthChange,
            y: parent.position.y - yChange + heightChange,
          },
        });

        /*
         * 处理同一父节点下的其他子节点:
         * 我们需要移动这些子节点，以抵消父节点位置的变化
         * 这样父节点扩展不会影响其他子节点的相对位置
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

// 处理节点DOM尺寸变化后的内部数据更新，包括测量节点尺寸、计算连接点位置和处理父节点扩展
// 更新节点的内部数据结构，根据DOM元素的实际尺寸和位置
export function updateNodeInternals<NodeType extends InternalNodeBase>(
  // 需要更新的节点信息映射
  updates: Map<string, InternalNodeUpdate>,
  // 节点查找表
  nodeLookup: NodeLookup<NodeType>,
  // 父子关系查找表
  parentLookup: ParentLookup<NodeType>,
  // 流程图DOM容器元素
  domNode: HTMLElement | null,
  // 节点原点配置
  nodeOrigin?: NodeOrigin,
  // 节点可移动范围
  nodeExtent?: CoordinateExtent
): { changes: (NodeDimensionChange | NodePositionChange)[]; updatedInternals: boolean } {
  // 获取视图容器元素
  const viewportNode = domNode?.querySelector('.xyflow__viewport');
  // 标记是否有内部数据更新
  let updatedInternals = false;

  // 如果找不到视图容器，返回空结果
  if (!viewportNode) {
    return { changes: [], updatedInternals };
  }

  // 存储节点变更信息
  const changes: (NodeDimensionChange | NodePositionChange)[] = [];
  // 获取视图容器的样式信息
  const style = window.getComputedStyle(viewportNode);
  // 从变换矩阵中提取当前缩放值
  const { m22: zoom } = new window.DOMMatrixReadOnly(style.transform);
  // 收集需要扩展父节点的子节点信息
  const parentExpandChildren: ParentExpandChild[] = [];

  // 遍历所有需要更新的节点
  for (const update of updates.values()) {
    // 获取节点数据
    const node = nodeLookup.get(update.id);
    // 如果节点不存在，跳过
    if (!node) {
      continue;
    }

    // 处理隐藏节点：清除句柄边界信息
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

    // 获取节点的实际DOM尺寸
    const dimensions = getDimensions(update.nodeElement);
    // 检查尺寸是否变化
    const dimensionChanged = node.measured.width !== dimensions.width || node.measured.height !== dimensions.height;
    // 确定是否需要更新：有尺寸并且(尺寸变化、无句柄边界或强制更新)
    const doUpdate = !!(
      dimensions.width &&
      dimensions.height &&
      (dimensionChanged || !node.internals.handleBounds || update.force)
    );

    // 如果需要更新
    if (doUpdate) {
      // 获取节点的DOM边界矩形
      const nodeBounds = update.nodeElement.getBoundingClientRect();
      // 获取节点的约束范围
      const extent = isCoordinateExtent(node.extent) ? node.extent : nodeExtent;
      // 获取节点的绝对位置
      let { positionAbsolute } = node.internals;

      // 根据节点的约束类型调整位置
      if (node.parentId && node.extent === 'parent') {
        // 如果节点限制在父节点内部，应用父节点约束
        positionAbsolute = clampPositionToParent(positionAbsolute, dimensions, nodeLookup.get(node.parentId)!);
      } else if (extent) {
        // 应用全局约束
        positionAbsolute = clampPosition(positionAbsolute, extent, dimensions);
      }

      // 创建更新后的节点对象
      const newNode = {
        ...node,
        measured: dimensions,
        internals: {
          ...node.internals,
          positionAbsolute,
          // 更新连接点边界信息
          handleBounds: {
            source: getHandleBounds('source', update.nodeElement, nodeBounds, zoom, node.id),
            target: getHandleBounds('target', update.nodeElement, nodeBounds, zoom, node.id),
          },
        },
      };

      // 更新节点查找表
      nodeLookup.set(node.id, newNode);

      // 如果是子节点，更新其在父节点中的位置
      if (node.parentId) {
        updateChildNode(newNode, nodeLookup, parentLookup, { nodeOrigin });
      }

      // 标记已更新内部数据
      updatedInternals = true;

      // 如果尺寸变化，记录变更并处理父节点扩展
      if (dimensionChanged) {
        // 添加尺寸变更记录
        changes.push({
          id: node.id,
          type: 'dimensions',
          dimensions,
        });

        // 如果节点设置为扩展父节点且有父节点，添加到父节点扩展列表
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

  // 如果有需要扩展父节点的子节点，处理父节点扩展
  if (parentExpandChildren.length > 0) {
    // 计算父节点扩展变更
    const parentExpandChanges = handleExpandParent(parentExpandChildren, nodeLookup, parentLookup, nodeOrigin);
    // 将父节点扩展变更添加到总变更列表
    changes.push(...parentExpandChanges);
  }

  // 返回变更列表和是否更新了内部数据的标记
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
