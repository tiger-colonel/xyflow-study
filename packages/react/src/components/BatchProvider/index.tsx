// 导入React相关的hooks和类型
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react';
// 导入边和节点的变更类型定义
import { EdgeChange, NodeChange } from '@xyflow/system';

// 导入状态存储访问hook
import { useStoreApi } from '../../hooks/useStore';
// 导入计算元素差异变更的工具函数
import { getElementsDiffChanges } from '../../utils';
// 导入队列相关的类型定义
import { Queue, QueueItem } from './types';
// 导入基础类型
import type { Edge, Node } from '../../types';
// 导入队列管理hook
import { useQueue } from './useQueue';

// 创建批处理上下文，包含节点队列和边队列
const BatchContext = createContext<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodeQueue: Queue<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edgeQueue: Queue<any>;
} | null>(null);

/**
 * 这是一个上下文提供程序，用于保存和处理节点和边更新队列，这些队列用于处理 setNodes、addNodes、setEdges 和 addEdges
 * @internal
 */
export function BatchProvider<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  children,
}: {
  children: ReactNode;
}) {
  // 获取React Flow状态存储
  const store = useStoreApi<NodeType, EdgeType>();

  // 定义处理节点队列项的回调函数
  const nodeQueueHandler = useCallback((queueItems: QueueItem<NodeType>[]) => {
    // 从存储中获取节点相关的状态
    const { nodes = [], setNodes, hasDefaultNodes, onNodesChange, nodeLookup } = store.getState();

    /*
     * This is essentially an `Array.reduce` in imperative clothing. Processing
     * this queue is a relatively hot path so we'd like to avoid the overhead of
     * array methods where we can.
     */
    // 初始化下一个节点数组
    let next = nodes;
    // 遍历队列项并应用更新
    for (const payload of queueItems) {
      // 如果payload是函数，调用它并传入当前节点数组；否则直接使用payload作为新节点数组
      next = typeof payload === 'function' ? payload(next) : payload;
    }

    // 根据配置决定如何应用节点更新
    if (hasDefaultNodes) {
      // 如果使用默认节点管理，直接设置新节点数组
      setNodes(next);
    } else if (onNodesChange) {
      // 如果提供了节点变更回调，计算变更差异并调用回调
      onNodesChange(
        getElementsDiffChanges({
          items: next,
          lookup: nodeLookup,
        }) as NodeChange<NodeType>[]
      );
    }
  }, []);
  // 创建节点队列，传入处理函数
  const nodeQueue = useQueue<NodeType>(nodeQueueHandler);

  // 定义处理边队列项的回调函数，逻辑与节点队列处理类似
  const edgeQueueHandler = useCallback((queueItems: QueueItem<EdgeType>[]) => {
    // 从存储中获取边相关的状态
    const { edges = [], setEdges, hasDefaultEdges, onEdgesChange, edgeLookup } = store.getState();

    // 初始化下一个边数组
    let next = edges;
    // 遍历队列项并应用更新
    for (const payload of queueItems) {
      // 如果payload是函数，调用它并传入当前边数组；否则直接使用payload作为新边数组
      next = typeof payload === 'function' ? payload(next) : payload;
    }

    // 根据配置决定如何应用边更新
    if (hasDefaultEdges) {
      // 如果使用默认边管理，直接设置新边数组
      setEdges(next);
    } else if (onEdgesChange) {
      // 如果提供了边变更回调，计算变更差异并调用回调
      onEdgesChange(
        getElementsDiffChanges({
          items: next,
          lookup: edgeLookup,
        }) as EdgeChange<EdgeType>[]
      );
    }
  }, []);
  // 创建边队列，传入处理函数
  const edgeQueue = useQueue<EdgeType>(edgeQueueHandler);

  // 使用useMemo缓存上下文值，避免不必要的重渲染
  const value = useMemo(() => ({ nodeQueue, edgeQueue }), []);

  // 返回上下文提供者组件，为子组件提供批处理队列
  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}

// 自定义hook，用于在组件中访问批处理上下文
export function useBatchContext() {
  // 获取批处理上下文
  const batchContext = useContext(BatchContext);

  // 如果不在BatchProvider内使用，抛出错误
  if (!batchContext) {
    throw new Error('useBatchContext must be used within a BatchProvider');
  }

  // 返回批处理上下文
  return batchContext;
}
