// 该组件帮助我们根据用户传入的值更新存储（store）。
// 我们区分两种更新方式：
// 可直接通过 useDirectStoreUpdater 更新的值（如 snapGrid）
// 需调用 store 中专用 setter 函数的值（如 setNodes）。
import { useEffect, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { infiniteExtent, type CoordinateExtent } from '@xyflow/system';

import { useStore, useStoreApi } from '../../hooks/useStore';
import type { Node, Edge, ReactFlowState, ReactFlowProps, FitViewOptions } from '../../types';
import { defaultNodeOrigin } from '../../container/ReactFlow/init-values';

// 这些字段存在于全局存储中，我们需要保持它们的最新状态
const reactFlowFieldsToTrack = [
  'nodes',
  'edges',
  'defaultNodes',
  'defaultEdges',
  'onConnect',
  'onConnectStart',
  'onConnectEnd',
  'onClickConnectStart',
  'onClickConnectEnd',
  'nodesDraggable',
  'nodesConnectable',
  'nodesFocusable',
  'edgesFocusable',
  'edgesReconnectable',
  'elevateNodesOnSelect',
  'elevateEdgesOnSelect',
  'minZoom',
  'maxZoom',
  'nodeExtent',
  'onNodesChange',
  'onEdgesChange',
  'elementsSelectable',
  'connectionMode',
  'snapGrid',
  'snapToGrid',
  'translateExtent',
  'connectOnClick',
  'defaultEdgeOptions',
  'fitView',
  'fitViewOptions',
  'onNodesDelete',
  'onEdgesDelete',
  'onDelete',
  'onNodeDrag',
  'onNodeDragStart',
  'onNodeDragStop',
  'onSelectionDrag',
  'onSelectionDragStart',
  'onSelectionDragStop',
  'onMoveStart',
  'onMove',
  'onMoveEnd',
  'noPanClassName',
  'nodeOrigin',
  'autoPanOnConnect',
  'autoPanOnNodeDrag',
  'onError',
  'connectionRadius',
  'isValidConnection',
  'selectNodesOnDrag',
  'nodeDragThreshold',
  'onBeforeDelete',
  'debug',
  'autoPanSpeed',
  'paneClickDistance',
] as const;

type ReactFlowFieldsToTrack = (typeof reactFlowFieldsToTrack)[number];
type StoreUpdaterProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = Pick<
  ReactFlowProps<NodeType, EdgeType>,
  ReactFlowFieldsToTrack
> & {
  rfId: string;
};

// rfId 不存在于 ReactFlowProps 中，但它是我们需要更新的字段之一
const fieldsToTrack = [...reactFlowFieldsToTrack, 'rfId'] as const;

const selector = (s: ReactFlowState) => ({
  setNodes: s.setNodes,
  setEdges: s.setEdges,
  setMinZoom: s.setMinZoom,
  setMaxZoom: s.setMaxZoom,
  setTranslateExtent: s.setTranslateExtent,
  setNodeExtent: s.setNodeExtent,
  reset: s.reset,
  setDefaultNodesAndEdges: s.setDefaultNodesAndEdges,
  setPaneClickDistance: s.setPaneClickDistance,
});

const initPrevValues = {
  /*
   * 这些值在 StoreUpdater 中被直接传递给 StoreUpdater 之外的其他组件
   * 通过在此处将相同值设为 prev 字段，我们可以减少 setStore 的调用次数
   */
  translateExtent: infiniteExtent,
  nodeOrigin: defaultNodeOrigin,
  minZoom: 0.5,
  maxZoom: 2,
  elementsSelectable: true,
  noPanClassName: 'nopan',
  rfId: '1',
  paneClickDistance: 0,
};

export function StoreUpdater<NodeType extends Node = Node, EdgeType extends Edge = Edge>(
  props: StoreUpdaterProps<NodeType, EdgeType>
) {
  const {
    setNodes,
    setEdges,
    setMinZoom,
    setMaxZoom,
    setTranslateExtent,
    setNodeExtent,
    reset,
    setDefaultNodesAndEdges,
    setPaneClickDistance,
  } = useStore(selector, shallow);
  const store = useStoreApi<NodeType, EdgeType>();

  useEffect(() => {
    setDefaultNodesAndEdges(props.defaultNodes, props.defaultEdges);

    return () => {
      // 当重置 store 时，我们也需要重置之前的字段
      previousFields.current = initPrevValues;
      reset();
    };
  }, []);

  const previousFields = useRef<Partial<StoreUpdaterProps<NodeType, EdgeType>>>(initPrevValues);

  useEffect(
    () => {
      for (const fieldName of fieldsToTrack) {
        const fieldValue = props[fieldName];
        const previousFieldValue = previousFields.current[fieldName];

        if (fieldValue === previousFieldValue) continue;
        if (typeof props[fieldName] === 'undefined') continue;
        // 部分字段需使用专用的 setter 方法进行自定义处理
        if (fieldName === 'nodes') setNodes(fieldValue as Node[]);
        else if (fieldName === 'edges') setEdges(fieldValue as Edge[]);
        else if (fieldName === 'minZoom') setMinZoom(fieldValue as number);
        else if (fieldName === 'maxZoom') setMaxZoom(fieldValue as number);
        else if (fieldName === 'translateExtent') setTranslateExtent(fieldValue as CoordinateExtent);
        else if (fieldName === 'nodeExtent') setNodeExtent(fieldValue as CoordinateExtent);
        else if (fieldName === 'paneClickDistance') setPaneClickDistance(fieldValue as number);
        // Renamed fields
        else if (fieldName === 'fitView') store.setState({ fitViewOnInit: fieldValue as boolean });
        else if (fieldName === 'fitViewOptions') store.setState({ fitViewOnInitOptions: fieldValue as FitViewOptions });
        // General case
        else store.setState({ [fieldName]: fieldValue });
      }

      previousFields.current = props;
    },
    // 仅在所追踪的任一字段发生变化时重新执行该副作用
    fieldsToTrack.map((fieldName) => props[fieldName])
  );

  return null;
}
