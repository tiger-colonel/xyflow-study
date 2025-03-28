import { useContext, useMemo } from 'react';
import { UseBoundStoreWithEqualityFn, useStoreWithEqualityFn as useZustandStore } from 'zustand/traditional';
import { StoreApi } from 'zustand';
import { errorMessages } from '@xyflow/system';

import StoreContext from '../contexts/StoreContext';
import type { Edge, Node, ReactFlowState } from '../types';

const zustandErrorMessage = errorMessages['error001']();

/**
 * 这个钩子函数可以用于订阅 React Flow 组件的内部状态变化。`useStore`
 * 钩子是从 [Zustand](https://github.com/pmndrs/zustand) 状态管理库
 * 再导出的，所以你可以查阅他们的文档获取更多详细信息。
 *
 * @public
 * @param selector 选择器函数
 * @param equalityFn 相等性比较函数
 * @returns 选中的状态切片
 *
 * @example
 * ```ts
 * const nodes = useStore((state) => state.nodes);
 * ```
 *
 * @remarks 只有在没有其他方式访问内部状态时，才应该使用此钩子。对于许多常见
 * 用例，已经有专门的钩子可用，如 {@link useReactFlow}、{@link useViewport} 等。
 */
function useStore<StateSlice = unknown>(
  selector: (state: ReactFlowState) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean
) {
  const store = useContext(StoreContext);

  if (store === null) {
    throw new Error(zustandErrorMessage);
  }

  return useZustandStore(store, selector, equalityFn);
}

/**
 * 在某些情况下，你可能需要直接访问存储。这个钩子返回存储对象，
 * 可以按需使用它来访问状态或者分发动作。
 *
 * @returns 存储对象
 *
 * @example
 * ```ts
 * const store = useStoreApi();
 * ```
 *
 * @remarks 只有在没有其他方式访问内部状态时，才应该使用此钩子。对于许多常见
 * 用例，已经有专门的钩子可用，如 {@link useReactFlow}、{@link useViewport} 等。
 */
function useStoreApi<NodeType extends Node = Node, EdgeType extends Edge = Edge>() {
  const store = useContext(StoreContext) as UseBoundStoreWithEqualityFn<
    StoreApi<ReactFlowState<NodeType, EdgeType>>
  > | null;

  if (store === null) {
    throw new Error(zustandErrorMessage);
  }

  return useMemo(
    () => ({
      getState: store.getState,
      setState: store.setState,
      subscribe: store.subscribe,
    }),
    [store]
  );
}

export { useStore, useStoreApi };
