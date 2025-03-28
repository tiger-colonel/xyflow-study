/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  EdgeLookup,
  NodeLookup,
  EdgeChange,
  NodeChange,
  NodeSelectionChange,
  EdgeSelectionChange,
  NodeRemoveChange,
  EdgeRemoveChange,
} from '@xyflow/system';
import type { Node, Edge, InternalNode } from '../types';

/*
 * 这个函数应用由React Flow内部触发的节点或边的变更。
 * 例如，当你拖动一个节点时，React Flow会发送一个位置变更更新。
 * 然后此函数应用这些变更并返回更新后的元素。
 */
function applyChanges(changes: any[], elements: any[]): any[] {
  const updatedElements: any[] = [];
  /*
   * 通过为每个元素存储变更的映射，我们可以在遍历元素数组时
   * 进行快速查找！
   */
  const changesMap = new Map<any, any[]>();
  const addItemChanges: any[] = [];

  for (const change of changes) {
    if (change.type === 'add') {
      addItemChanges.push(change);
      continue;
    } else if (change.type === 'remove' || change.type === 'replace') {
      /*
       * 对于'remove'类型的变更，我们可以安全地忽略为同一元素
       * 排队的任何其他变更，因为它无论如何都会被移除！
       */
      changesMap.set(change.id, [change]);
    } else {
      const elementChanges = changesMap.get(change.id);

      if (elementChanges) {
        /*
         * 如果我们已经有一些变更排队，我们可以对该数组进行可变更新，
         * 从而节省一些复制操作。
         */
        elementChanges.push(change);
      } else {
        changesMap.set(change.id, [change]);
      }
    }
  }

  for (const element of elements) {
    const changes = changesMap.get(element.id);

    /*
     * 当元素没有变更时，我们可以直接将其推入不加修改，
     * 无需复制。
     */
    if (!changes) {
      updatedElements.push(element);
      continue;
    }

    // 如果我们有一个'remove'变更排队，它将是数组中唯一的变更
    if (changes[0].type === 'remove') {
      continue;
    }

    if (changes[0].type === 'replace') {
      updatedElements.push({ ...changes[0].item });
      continue;
    }

    /**
     * 对于其他类型的变更，我们希望从对象的浅拷贝开始，
     * 这样React知道这个元素已经改变。连续的变更将
     * 每个_修改_这个对象，所以只有一个副本。
     */
    const updatedElement = { ...element };

    for (const change of changes) {
      applyChange(change, updatedElement);
    }

    updatedElements.push(updatedElement);
  }

  /*
   * 我们需要等待所有变更应用后再添加新项，
   * 以便能够在正确的索引处添加它们
   */
  if (addItemChanges.length) {
    addItemChanges.forEach((change) => {
      if (change.index !== undefined) {
        updatedElements.splice(change.index, 0, { ...change.item });
      } else {
        updatedElements.push({ ...change.item });
      }
    });
  }

  return updatedElements;
}

// 将单个变更应用到元素。这是一个*可变*更新。
function applyChange(change: any, element: any): any {
  switch (change.type) {
    case 'select': {
      element.selected = change.selected;
      break;
    }

    case 'position': {
      if (typeof change.position !== 'undefined') {
        element.position = change.position;
      }

      if (typeof change.dragging !== 'undefined') {
        element.dragging = change.dragging;
      }

      break;
    }

    case 'dimensions': {
      if (typeof change.dimensions !== 'undefined') {
        element.measured ??= {};
        element.measured.width = change.dimensions.width;
        element.measured.height = change.dimensions.height;

        if (change.setAttributes) {
          element.width = change.dimensions.width;
          element.height = change.dimensions.height;
        }
      }

      if (typeof change.resizing === 'boolean') {
        element.resizing = change.resizing;
      }

      break;
    }
  }
}

/**
 * 即插即用的函数，将节点变更应用到节点数组。
 * @public
 * @param changes - 要应用的变更数组
 * @param nodes - 要应用变更的节点数组
 * @returns 更新后的节点数组
 * @example
 *```tsx
 *import { useState, useCallback } from 'react';
 *import { ReactFlow, applyNodeChanges, type Node, type Edge, type OnNodesChange } from '@xyflow/react';
 *
 *export default function Flow() {
 *  const [nodes, setNodes] = useState<Node[]>([]);
 *  const [edges, setEdges] = useState<Edge[]>([]);
 *  const onNodesChange: OnNodesChange = useCallback(
 *    (changes) => {
 *      setNodes((oldNodes) => applyNodeChanges(changes, oldNodes));
 *    },
 *    [setNodes],
 *  );
 *
 *  return (
 *    <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} />
 *  );
 *}
 *```
 * @remarks <ReactFlow /> 组件上的各种事件可以产生 {@link NodeChange}，
 * 它描述了如何以某种方式更新流程的节点。
 * 如果你不需要任何自定义行为，可以使用这个工具来接收这些变更的数组
 * 并将它们应用到你的节点上。
 */
export function applyNodeChanges<NodeType extends Node = Node>(
  changes: NodeChange<NodeType>[],
  nodes: NodeType[]
): NodeType[] {
  return applyChanges(changes, nodes) as NodeType[];
}

/**
 * 即插即用的函数，将边变更应用到边数组。
 * @public
 * @param changes - 要应用的变更数组
 * @param edges - 要应用变更的边数组
 * @returns 更新后的边数组
 * @example
 * ```tsx
 *import { useState, useCallback } from 'react';
 *import { ReactFlow, applyEdgeChanges } from '@xyflow/react';
 *
 *export default function Flow() {
 *  const [nodes, setNodes] = useState([]);
 *  const [edges, setEdges] = useState([]);
 *  const onEdgesChange = useCallback(
 *    (changes) => {
 *      setEdges((oldEdges) => applyEdgeChanges(changes, oldEdges));
 *    },
 *    [setEdges],
 *  );
 *
 *  return (
 *    <ReactFlow nodes={nodes} edges={edges} onEdgesChange={onEdgesChange} />
 *  );
 *}
 *```
 * @remarks <ReactFlow /> 组件上的各种事件可以产生 {@link EdgeChange}，
 * 它描述了如何以某种方式更新流程的边。
 * 如果你不需要任何自定义行为，可以使用这个工具来接收这些变更的数组
 * 并将它们应用到你的边上。
 */
export function applyEdgeChanges<EdgeType extends Edge = Edge>(
  changes: EdgeChange<EdgeType>[],
  edges: EdgeType[]
): EdgeType[] {
  return applyChanges(changes, edges) as EdgeType[];
}

export function createSelectionChange(id: string, selected: boolean): NodeSelectionChange | EdgeSelectionChange {
  return {
    id,
    type: 'select',
    selected,
  };
}

export function getSelectionChanges(
  items: Map<string, any>,
  selectedIds: Set<string> = new Set(),
  mutateItem = false
): NodeSelectionChange[] | EdgeSelectionChange[] {
  const changes: NodeSelectionChange[] | EdgeSelectionChange[] = [];

  for (const [id, item] of items) {
    const willBeSelected = selectedIds.has(id);

    // 当第一次选择时，我们不想将所有项目设置为selected=false
    if (!(item.selected === undefined && !willBeSelected) && item.selected !== willBeSelected) {
      if (mutateItem) {
        /*
         * 这个技巧对节点是必要的。当用户拖动一个节点时，它被选中。
         * 当另一个节点被拖动时，我们需要取消选择前一个节点，
         * 以便一次只有一个节点被选中 - onNodesChange回调在这里来得太晚了 :/
         */
        item.selected = willBeSelected;
      }
      changes.push(createSelectionChange(item.id, willBeSelected));
    }
  }

  return changes;
}

/**
 * 这个函数用于找出两组元素之间的变更。
 * 它用于确定哪些节点或边已被添加、移除或替换。
 *
 * @internal
 * @param params.items = 下一组元素（节点或边）
 * @param params.lookup = 当前存储元素的查找映射
 * @returns 变更数组
 */
export function getElementsDiffChanges({
  items,
  lookup,
}: {
  items: Node[] | undefined;
  lookup: NodeLookup<InternalNode<Node>>;
}): NodeChange[];
export function getElementsDiffChanges({
  items,
  lookup,
}: {
  items: Edge[] | undefined;
  lookup: EdgeLookup;
}): EdgeChange[];
export function getElementsDiffChanges({
  items = [],
  lookup,
}: {
  items: any[] | undefined;
  lookup: Map<string, any>;
}): any[] {
  const changes: any[] = [];
  const itemsLookup = new Map<string, any>(items.map((item) => [item.id, item]));

  for (const [index, item] of items.entries()) {
    const lookupItem = lookup.get(item.id);
    const storeItem = lookupItem?.internals?.userNode ?? lookupItem;

    // 检测替换：如果元素ID已存在于当前存储，但引用不同（不是同一对象），则创建replace类型变更。这是引用相等比较，不是深度比较。
    if (storeItem !== undefined && storeItem !== item) {
      changes.push({ id: item.id, item: item, type: 'replace' });
    }

    // 检测添加：如果元素ID在当前存储中不存在，则创建add类型变更，并记录应插入的位置索引。
    if (storeItem === undefined) {
      changes.push({ item: item, type: 'add', index });
    }
  }

  // 遍历当前存储中的所有元素ID，检查每个ID是否存在于新元素集合。如果不存在（在新集合中被移除），则创建remove类型变更。
  for (const [id] of lookup) {
    const nextNode = itemsLookup.get(id);

    if (nextNode === undefined) {
      changes.push({ id, type: 'remove' });
    }
  }

  return changes;
}

export function elementToRemoveChange<T extends Node | Edge>(item: T): NodeRemoveChange | EdgeRemoveChange {
  return {
    id: item.id,
    type: 'remove',
  };
}
