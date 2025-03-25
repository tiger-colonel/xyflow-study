import { type NodeDragItem, type XYPosition, InternalNodeBase, NodeBase, NodeLookup } from '../types'; // 导入类型定义和接口

export function isParentSelected<NodeType extends NodeBase>(node: NodeType, nodeLookup: NodeLookup): boolean {
  // 检查节点的父节点是否被选中
  if (!node.parentId) {
    // 如果节点没有父节点ID，返回false
    return false;
  }

  const parentNode = nodeLookup.get(node.parentId); // 获取父节点

  if (!parentNode) {
    // 如果父节点不存在，返回false
    return false;
  }

  if (parentNode.selected) {
    // 如果父节点被选中，返回true
    return true;
  }

  return isParentSelected(parentNode, nodeLookup); // 递归检查父节点的父节点是否被选中
}

export function hasSelector(target: Element | EventTarget | null, selector: string, domNode: Element): boolean {
  // 检查目标元素是否匹配选择器
  let current = target as Partial<Element> | null | undefined; // 初始化当前元素为目标元素

  do {
    if (current?.matches?.(selector)) return true; // 如果当前元素匹配选择器，返回true
    if (current === domNode) return false; // 如果当前元素是DOM节点，返回false
    current = current?.parentElement; // 移动到父元素
  } while (current);

  return false; // 如果没有匹配到，返回false
}

// 查找所有选中的节点并为每个节点创建一个NodeDragItem
export function getDragItems<NodeType extends NodeBase>(
  nodeLookup: Map<string, InternalNodeBase<NodeType>>, // 节点查找映射
  nodesDraggable: boolean, // 节点是否可拖拽
  mousePos: XYPosition, // 鼠标位置
  nodeId?: string // 可选的节点ID
): Map<string, NodeDragItem> {
  const dragItems = new Map<string, NodeDragItem>(); // 创建一个新的Map存储拖拽项

  for (const [id, node] of nodeLookup) {
    // 遍历所有节点
    if (
      (node.selected || node.id === nodeId) && // 节点被选中或是当前指定的节点
      (!node.parentId || !isParentSelected(node, nodeLookup)) && // 其父节点未被选中
      (node.draggable || (nodesDraggable && typeof node.draggable === 'undefined')) // 节点可拖拽
    ) {
      const internalNode = nodeLookup.get(id); // 获取内部节点

      if (internalNode) {
        // 如果内部节点存在
        dragItems.set(id, {
          // 创建拖拽项
          id,
          position: internalNode.position || { x: 0, y: 0 }, // 设置位置
          distance: {
            // 计算鼠标与节点绝对位置的距离
            x: mousePos.x - internalNode.internals.positionAbsolute.x,
            y: mousePos.y - internalNode.internals.positionAbsolute.y,
          },
          extent: internalNode.extent, // 节点范围
          parentId: internalNode.parentId, // 父节点ID
          origin: internalNode.origin, // 节点原点
          expandParent: internalNode.expandParent, // 是否扩展父节点
          internals: {
            // 内部数据
            positionAbsolute: internalNode.internals.positionAbsolute || { x: 0, y: 0 }, // 绝对位置
          },
          measured: {
            // 测量尺寸
            width: internalNode.measured.width ?? 0, // 宽度
            height: internalNode.measured.height ?? 0, // 高度
          },
        });
      }
    }
  }

  return dragItems; // 返回拖拽项Map
}

/*
 * 返回两个参数:
 * 1. 被拖拽的节点（或者如果我们拖拽的是节点选择，则返回列表中的第一个）
 * 2. 选中节点的数组（用于多选）
 */
export function getEventHandlerParams<NodeType extends InternalNodeBase>({
  nodeId, // 节点ID
  dragItems, // 拖拽项
  nodeLookup, // 节点查找映射
  dragging = true, // 是否正在拖拽
}: {
  nodeId?: string;
  dragItems: Map<string, NodeDragItem>;
  nodeLookup: Map<string, NodeType>;
  dragging?: boolean;
}): [NodeBase, NodeBase[]] {
  const nodesFromDragItems: NodeBase[] = []; // 存储从拖拽项中获取的节点

  for (const [id, dragItem] of dragItems) {
    // 遍历所有拖拽项
    const node = nodeLookup.get(id)?.internals.userNode; // 获取用户节点

    if (node) {
      // 如果节点存在
      nodesFromDragItems.push({
        // 添加到数组
        ...node,
        position: dragItem.position, // 使用拖拽项中的位置
        dragging, // 设置拖拽状态
      });
    }
  }

  if (!nodeId) {
    // 如果没有指定节点ID
    return [nodesFromDragItems[0], nodesFromDragItems]; // 返回第一个节点和所有节点
  }

  const node = nodeLookup.get(nodeId)?.internals.userNode; // 获取指定ID的节点

  return [
    // 返回指定节点（如果存在）和所有节点
    !node
      ? nodesFromDragItems[0] // 如果节点不存在，返回第一个拖拽节点
      : {
          ...node,
          position: dragItems.get(nodeId)?.position || node.position, // 使用拖拽项中的位置或节点原始位置
          dragging, // 设置拖拽状态
        },
    nodesFromDragItems, // 所有拖拽节点
  ];
}
