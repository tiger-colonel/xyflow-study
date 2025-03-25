/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  boxToRect,
  clampPosition,
  getBoundsOfBoxes,
  getOverlappingArea,
  nodeToRect,
  pointToRendererPoint,
  getViewportForBounds,
  isCoordinateExtent,
  getNodeDimensions,
  nodeToBox,
} from './general';
import {
  type Transform,
  type XYPosition,
  type Rect,
  type NodeOrigin,
  type NodeBase,
  type EdgeBase,
  type FitViewParamsBase,
  type FitViewOptionsBase,
  CoordinateExtent,
  OnError,
  OnBeforeDeleteBase,
  NodeLookup,
  InternalNodeBase,
  NodeDragItem,
} from '../types';
import { errorMessages } from '../constants';

/**
 * 测试一个对象是否可用作Edge
 * @public
 * @remarks 在TypeScript中，这是一个类型保护，如果返回true，它将把传入的元素类型缩小为Edge
 * @param element - 要测试的元素
 * @returns 一个布尔值，指示元素是否为Edge
 */
export const isEdgeBase = <EdgeType extends EdgeBase = EdgeBase>(element: any): element is EdgeType =>
  'id' in element && 'source' in element && 'target' in element;

/**
 * 测试一个对象是否可用作Node
 * @public
 * @remarks 在TypeScript中，这是一个类型保护，如果返回true，它将把传入的元素类型缩小为Node
 * @param element - 要测试的元素
 * @returns 一个布尔值，指示元素是否为Node
 */
export const isNodeBase = <NodeType extends NodeBase = NodeBase>(element: any): element is NodeType =>
  'id' in element && 'position' in element && !('source' in element) && !('target' in element);

/**
 * 测试一个对象是否是内部节点类型
 * @public
 * @remarks 在TypeScript中，这是一个类型保护，如果返回true，它将把传入的元素类型缩小为InternalNodeBase
 * @param element - 要测试的元素
 * @returns 一个布尔值，指示元素是否为内部节点类型
 */
export const isInternalNodeBase = <NodeType extends InternalNodeBase = InternalNodeBase>(
  element: any
): element is NodeType => 'id' in element && 'internals' in element && !('source' in element) && !('target' in element);

/**
 * 此工具用于告诉你哪些节点（如果有的话）作为边的_目标_连接到给定节点。
 * @public
 * @param node - 要获取连接节点的节点
 * @param nodes - 所有节点的数组
 * @param edges - 所有边的数组
 * @returns 通过边连接的节点数组，其中源是给定节点
 *
 * @example
 * ```ts
 *import { getOutgoers } from '@xyflow/react';
 *
 *const nodes = [];
 *const edges = [];
 *
 *const outgoers = getOutgoers(
 *  { id: '1', position: { x: 0, y: 0 }, data: { label: 'node' } },
 *  nodes,
 *  edges,
 *);
 *```
 */
export const getOutgoers = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }

  const outgoerIds = new Set();
  edges.forEach((edge) => {
    if (edge.source === node.id) {
      outgoerIds.add(edge.target);
    }
  });

  return nodes.filter((n) => outgoerIds.has(n.id));
};

/**
 * 此工具用于告诉你哪些节点（如果有的话）作为边的_源_连接到给定节点。
 * @public
 * @param node - 要获取连接节点的节点
 * @param nodes - 所有节点的数组
 * @param edges - 所有边的数组
 * @returns 通过边连接的节点数组，其中目标是给定节点
 *
 * @example
 * ```ts
 *import { getIncomers } from '@xyflow/react';
 *
 *const nodes = [];
 *const edges = [];
 *
 *const incomers = getIncomers(
 *  { id: '1', position: { x: 0, y: 0 }, data: { label: 'node' } },
 *  nodes,
 *  edges,
 *);
 *```
 */
export const getIncomers = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }
  const incomersIds = new Set();
  edges.forEach((edge) => {
    if (edge.target === node.id) {
      incomersIds.add(edge.source);
    }
  });

  return nodes.filter((n) => incomersIds.has(n.id));
};

/**
 * 计算节点位置，考虑节点原点偏移
 * @public
 * @param node - 要计算位置的节点
 * @param nodeOrigin - 节点的原点坐标，默认为[0, 0]（左上角）
 * @returns 考虑了原点偏移后的节点位置
 */
export const getNodePositionWithOrigin = (node: NodeBase, nodeOrigin: NodeOrigin = [0, 0]): XYPosition => {
  const { width, height } = getNodeDimensions(node);
  const origin = node.origin ?? nodeOrigin;
  const offsetX = width * origin[0];
  const offsetY = height * origin[1];

  return {
    x: node.position.x - offsetX,
    y: node.position.y - offsetY,
  };
};

export type GetNodesBoundsParams<NodeType extends NodeBase = NodeBase> = {
  nodeOrigin?: NodeOrigin;
  nodeLookup?: NodeLookup<InternalNodeBase<NodeType>>;
};

/**
 * 返回包含数组中所有给定节点的边界框。当与[`getViewportForBounds`](/api-reference/utils/get-viewport-for-bounds)
 * 结合使用时，这对于计算正确的变换以使给定节点适合视口非常有用。
 * @public
 * @remarks 与{@link getViewportForBounds}结合使用时有用，可以计算正确的变换以使给定节点适合视口。
 * @param nodes - 要计算边界的节点
 * @param params.nodeOrigin - 节点的原点：[0, 0] - 左上角，[0.5, 0.5] - 中心
 * @returns 包围所有节点的边界框
 *
 * @remarks 此函数以前被称为`getRectOfNodes`
 *
 * @example
 * ```js
 *import { getNodesBounds } from '@xyflow/react';
 *
 *const nodes = [
 *  {
 *    id: 'a',
 *    position: { x: 0, y: 0 },
 *    data: { label: 'a' },
 *    width: 50,
 *    height: 25,
 *  },
 *  {
 *    id: 'b',
 *    position: { x: 100, y: 100 },
 *    data: { label: 'b' },
 *    width: 50,
 *    height: 25,
 *  },
 *];
 *
 *const bounds = getNodesBounds(nodes);
 *```
 */
export const getNodesBounds = <NodeType extends NodeBase = NodeBase>(
  nodes: (NodeType | InternalNodeBase<NodeType> | string)[],
  params: GetNodesBoundsParams<NodeType> = { nodeOrigin: [0, 0], nodeLookup: undefined }
): Rect => {
  if (process.env.NODE_ENV === 'development' && !params.nodeLookup) {
    console.warn(
      'Please use `getNodesBounds` from `useReactFlow`/`useSvelteFlow` hook to ensure correct values for sub flows. If not possible, you have to provide a nodeLookup to support sub flows.'
    );
  }

  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const box = nodes.reduce(
    (currBox, nodeOrId) => {
      const isId = typeof nodeOrId === 'string';
      let currentNode = !params.nodeLookup && !isId ? nodeOrId : undefined;

      if (params.nodeLookup) {
        currentNode = isId
          ? params.nodeLookup.get(nodeOrId)
          : !isInternalNodeBase(nodeOrId)
          ? params.nodeLookup.get(nodeOrId.id)
          : nodeOrId;
      }

      const nodeBox = currentNode ? nodeToBox(currentNode, params.nodeOrigin) : { x: 0, y: 0, x2: 0, y2: 0 };
      return getBoundsOfBoxes(currBox, nodeBox);
    },
    { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }
  );

  return boxToRect(box);
};

export type GetInternalNodesBoundsParams<NodeType> = {
  useRelativePosition?: boolean;
  filter?: (node: NodeType) => boolean;
};

/**
 * 确定包含数组中所有给定节点的边界框
 * @internal
 */
export const getInternalNodesBounds = <NodeType extends InternalNodeBase | NodeDragItem>(
  nodeLookup: Map<string, NodeType>,
  params: GetInternalNodesBoundsParams<NodeType> = {}
): Rect => {
  if (nodeLookup.size === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let box = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };

  nodeLookup.forEach((node) => {
    if (params.filter === undefined || params.filter(node)) {
      const nodeBox = nodeToBox(node as InternalNodeBase);
      box = getBoundsOfBoxes(box, nodeBox);
    }
  });

  return boxToRect(box);
};

/**
 * 获取在指定矩形区域内的节点
 * @internal
 * @param nodes - 所有节点的Map集合
 * @param rect - 要检查的矩形区域
 * @param transform - 画布的变换[x偏移, y偏移, 缩放比例]
 * @param partially - 如果设为true，则部分在区域内的节点也会被包含
 * @param excludeNonSelectableNodes - 是否排除不可选择的节点
 * @returns 在指定区域内的节点数组
 */
export const getNodesInside = <NodeType extends NodeBase = NodeBase>(
  nodes: Map<string, InternalNodeBase<NodeType>>,
  rect: Rect,
  [tx, ty, tScale]: Transform = [0, 0, 1],
  partially = false,
  // 如果你想关注节点的"selectable"属性，请设置excludeNonSelectableNodes
  excludeNonSelectableNodes = false
): InternalNodeBase<NodeType>[] => {
  const paneRect = {
    ...pointToRendererPoint(rect, [tx, ty, tScale]),
    width: rect.width / tScale,
    height: rect.height / tScale,
  };

  const visibleNodes: InternalNodeBase<NodeType>[] = [];

  for (const node of nodes.values()) {
    const { measured, selectable = true, hidden = false } = node;

    if ((excludeNonSelectableNodes && !selectable) || hidden) {
      continue;
    }

    const width = measured.width ?? node.width ?? node.initialWidth ?? null;
    const height = measured.height ?? node.height ?? node.initialHeight ?? null;

    const overlappingArea = getOverlappingArea(paneRect, nodeToRect(node));
    const area = (width ?? 0) * (height ?? 0);

    const partiallyVisible = partially && overlappingArea > 0;
    const forceInitialRender = !node.internals.handleBounds;
    const isVisible = forceInitialRender || partiallyVisible || overlappingArea >= area;

    if (isVisible || node.dragging) {
      visibleNodes.push(node);
    }
  }

  return visibleNodes;
};

/**
 * 此工具过滤边的数组，只保留源节点或目标节点存在于给定节点数组中的边。
 * @public
 * @param nodes - 你想获取连接边的节点
 * @param edges - 所有边
 * @returns 连接任何给定节点与其他节点的边的数组
 *
 * @example
 * ```js
 *import { getConnectedEdges } from '@xyflow/react';
 *
 *const nodes = [
 *  { id: 'a', position: { x: 0, y: 0 } },
 *  { id: 'b', position: { x: 100, y: 0 } },
 *];
 *
 *const edges = [
 *  { id: 'a->c', source: 'a', target: 'c' },
 *  { id: 'c->d', source: 'c', target: 'd' },
 *];
 *
 *const connectedEdges = getConnectedEdges(nodes, edges);
 * // => [{ id: 'a->c', source: 'a', target: 'c' }]
 *```
 */
export const getConnectedEdges = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  nodes: NodeType[],
  edges: EdgeType[]
): EdgeType[] => {
  const nodeIds = new Set();
  nodes.forEach((node) => {
    nodeIds.add(node.id);
  });

  return edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
};

/**
 * 根据选项过滤出符合适配视图条件的节点
 * @internal
 * @param nodeLookup - 所有节点的查找表
 * @param options - 过滤选项，可以指定特定节点和是否包含隐藏节点
 * @returns 过滤后的节点查找表，只包含将用于适配视图的节点
 */
export function getFitViewNodes<
  Params extends NodeLookup<InternalNodeBase<NodeBase>>,
  Options extends FitViewOptionsBase<NodeBase>
>(nodeLookup: Params, options?: Pick<Options, 'nodes' | 'includeHiddenNodes'>) {
  const fitViewNodes: NodeLookup = new Map();
  const optionNodeIds = options?.nodes ? new Set(options.nodes.map((node) => node.id)) : null;

  nodeLookup.forEach((n) => {
    const isVisible = n.measured.width && n.measured.height && (options?.includeHiddenNodes || !n.hidden);

    if (isVisible && (!optionNodeIds || optionNodeIds.has(n.id))) {
      fitViewNodes.set(n.id, n);
    }
  });

  return fitViewNodes;
}

/**
 * 调整视图以适配指定的节点
 * @internal
 * @param params - 包含节点、视口尺寸和缩放限制的参数
 * @param options - 适配视图的选项，如填充、动画持续时间等
 * @returns Promise，解析为是否成功适配视图
 */
export async function fitView<Params extends FitViewParamsBase<NodeBase>, Options extends FitViewOptionsBase<NodeBase>>(
  { nodes, width, height, panZoom, minZoom, maxZoom }: Params,
  options?: Omit<Options, 'nodes' | 'includeHiddenNodes'>
): Promise<boolean> {
  if (nodes.size === 0) {
    return Promise.resolve(false);
  }

  const bounds = getInternalNodesBounds(nodes);

  const viewport = getViewportForBounds(
    bounds,
    width,
    height,
    options?.minZoom ?? minZoom,
    options?.maxZoom ?? maxZoom,
    options?.padding ?? 0.1
  );

  await panZoom.setViewport(viewport, { duration: options?.duration });

  return Promise.resolve(true);
}

/**
 * 此函数计算节点的下一个位置，考虑节点的范围、父节点和原点。
 *
 * @internal
 * @returns position, positionAbsolute
 */
export function calculateNodePosition<NodeType extends NodeBase>({
  nodeId,
  nextPosition,
  nodeLookup,
  nodeOrigin = [0, 0],
  nodeExtent,
  onError,
}: {
  nodeId: string;
  nextPosition: XYPosition;
  nodeLookup: NodeLookup<InternalNodeBase<NodeType>>;
  nodeOrigin?: NodeOrigin;
  nodeExtent?: CoordinateExtent;
  onError?: OnError;
}): { position: XYPosition; positionAbsolute: XYPosition } {
  const node = nodeLookup.get(nodeId)!;
  const parentNode = node.parentId ? nodeLookup.get(node.parentId) : undefined;
  const { x: parentX, y: parentY } = parentNode ? parentNode.internals.positionAbsolute : { x: 0, y: 0 };

  const origin = node.origin ?? nodeOrigin;
  let extent = nodeExtent;

  if (node.extent === 'parent' && !node.expandParent) {
    if (!parentNode) {
      onError?.('005', errorMessages['error005']());
    } else {
      const parentWidth = parentNode.measured.width;
      const parentHeight = parentNode.measured.height;

      if (parentWidth && parentHeight) {
        extent = [
          [parentX, parentY],
          [parentX + parentWidth, parentY + parentHeight],
        ];
      }
    }
  } else if (parentNode && isCoordinateExtent(node.extent)) {
    extent = [
      [node.extent[0][0] + parentX, node.extent[0][1] + parentY],
      [node.extent[1][0] + parentX, node.extent[1][1] + parentY],
    ];
  }

  const positionAbsolute = isCoordinateExtent(extent)
    ? clampPosition(nextPosition, extent, node.measured)
    : nextPosition;

  if (node.measured.width === undefined || node.measured.height === undefined) {
    onError?.('015', errorMessages['error015']());
  }

  return {
    position: {
      x: positionAbsolute.x - parentX + (node.measured.width ?? 0) * origin[0],
      y: positionAbsolute.y - parentY + (node.measured.height ?? 0) * origin[1],
    },
    positionAbsolute,
  };
}

/**
 * 传入要删除的节点和边，获取实际可以删除的节点和边数组
 * @internal
 * @param param.nodesToRemove - 要移除的节点
 * @param param.edgesToRemove - 要移除的边
 * @param param.nodes - 所有节点
 * @param param.edges - 所有边
 * @param param.onBeforeDelete - 检查哪些节点和边可以删除的回调
 * @returns nodes: 可以删除的节点, edges: 可以删除的边
 */
export async function getElementsToRemove<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>({
  nodesToRemove = [],
  edgesToRemove = [],
  nodes,
  edges,
  onBeforeDelete,
}: {
  nodesToRemove: Partial<NodeType>[];
  edgesToRemove: Partial<EdgeType>[];
  nodes: NodeType[];
  edges: EdgeType[];
  onBeforeDelete?: OnBeforeDeleteBase<NodeType, EdgeType>;
}): Promise<{
  nodes: NodeType[];
  edges: EdgeType[];
}> {
  const nodeIds = new Set(nodesToRemove.map((node) => node.id));
  const matchingNodes: NodeType[] = [];

  for (const node of nodes) {
    if (node.deletable === false) {
      continue;
    }

    const isIncluded = nodeIds.has(node.id);
    const parentHit = !isIncluded && node.parentId && matchingNodes.find((n) => n.id === node.parentId);

    if (isIncluded || parentHit) {
      matchingNodes.push(node);
    }
  }

  const edgeIds = new Set(edgesToRemove.map((edge) => edge.id));
  const deletableEdges = edges.filter((edge) => edge.deletable !== false);
  const connectedEdges = getConnectedEdges(matchingNodes, deletableEdges);
  const matchingEdges: EdgeType[] = connectedEdges;

  for (const edge of deletableEdges) {
    const isIncluded = edgeIds.has(edge.id);

    if (isIncluded && !matchingEdges.find((e) => e.id === edge.id)) {
      matchingEdges.push(edge);
    }
  }

  if (!onBeforeDelete) {
    return {
      edges: matchingEdges,
      nodes: matchingNodes,
    };
  }

  const onBeforeDeleteResult = await onBeforeDelete({
    nodes: matchingNodes,
    edges: matchingEdges,
  });

  if (typeof onBeforeDeleteResult === 'boolean') {
    return onBeforeDeleteResult ? { edges: matchingEdges, nodes: matchingNodes } : { edges: [], nodes: [] };
  }

  return onBeforeDeleteResult;
}
