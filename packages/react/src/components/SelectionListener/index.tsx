/*
    这是一个用于调用 onSelectionChange 监听器的辅助组件
    仅当用户传入了 onSelectionChange 监听器或正在使用 useOnSelectionChange 钩子时才会被挂载
    @待办：既然现在已有 onNodesChange 和 onEdgesChange 监听器，我们是否仍需要保留该组件？
 */
import { useEffect } from 'react';
import { shallow } from 'zustand/shallow';

import { useStore, useStoreApi } from '../../hooks/useStore';
import type { ReactFlowState, OnSelectionChangeFunc, Node, Edge } from '../../types';

type SelectionListenerProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = {
  onSelectionChange?: OnSelectionChangeFunc<NodeType, EdgeType>;
};

const selector = (s: ReactFlowState) => {
  const selectedNodes = [];
  const selectedEdges = [];

  for (const [, node] of s.nodeLookup) {
    if (node.selected) {
      selectedNodes.push(node.internals.userNode);
    }
  }

  for (const [, edge] of s.edgeLookup) {
    if (edge.selected) {
      selectedEdges.push(edge);
    }
  }

  return { selectedNodes, selectedEdges };
};

type SelectorSlice = ReturnType<typeof selector>;

const selectId = (obj: Node | Edge) => obj.id;

function areEqual(a: SelectorSlice, b: SelectorSlice) {
  return (
    shallow(a.selectedNodes.map(selectId), b.selectedNodes.map(selectId)) &&
    shallow(a.selectedEdges.map(selectId), b.selectedEdges.map(selectId))
  );
}

function SelectionListenerInner<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  onSelectionChange,
}: SelectionListenerProps<NodeType, EdgeType>) {
  const store = useStoreApi<NodeType, EdgeType>();
  const { selectedNodes, selectedEdges } = useStore(selector, areEqual);

  useEffect(() => {
    const params = { nodes: selectedNodes as NodeType[], edges: selectedEdges as EdgeType[] };

    onSelectionChange?.(params);
    store.getState().onSelectionChangeHandlers.forEach((fn) => fn(params));
  }, [selectedNodes, selectedEdges, onSelectionChange]);

  return null;
}

const changeSelector = (s: ReactFlowState) => !!s.onSelectionChangeHandlers;

export function SelectionListener<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  onSelectionChange,
}: SelectionListenerProps<NodeType, EdgeType>) {
  const storeHasSelectionChangeHandlers = useStore(changeSelector);

  if (onSelectionChange || storeHasSelectionChangeHandlers) {
    return <SelectionListenerInner<NodeType, EdgeType> onSelectionChange={onSelectionChange} />;
  }

  return null;
}
