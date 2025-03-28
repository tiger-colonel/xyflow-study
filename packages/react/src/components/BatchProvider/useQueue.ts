import { useState } from 'react';

import { useIsomorphicLayoutEffect } from '../../hooks/useIsomorphicLayoutEffect';
import { Queue, QueueItem } from './types';

/**
 * 这个 hook 返回一个可用于批量更新的队列。
 *
 * @param runQueue - 当队列被刷新时调用的函数
 * @internal
 *
 * @returns 一个 Queue 对象
 */
export function useQueue<T>(runQueue: (items: QueueItem<T>[]) => void) {
  /*
   * 因为我们上面使用了引用，所以需要某种方式让 React 知道何时实际处理队列。
   * 每当我们修改队列时，我们都会增加这个数字，创建一个新的状态来触发下面的布局效果。
   * 在这里使用布尔型的脏标志会导致自动批处理相关的问题。(https://github.com/xyflow/xyflow/issues/4779)
   */
  const [serial, setSerial] = useState(BigInt(0));

  /*
   * 在下一次渲染之前需要处理的所有批量更新的引用。我们在这里需要一个引用，
   * 这样对 `setNodes` 等的多个同步调用可以一起批处理。
   */
  const [queue] = useState(() => createQueue<T>(() => setSerial((n) => n + BigInt(1))));

  /*
   * 布局效果保证在下一次渲染之前运行，这意味着我们不应该遇到陈旧状态的问题，
   * 或者由于比预期晚一帧渲染而导致的奇怪问题（我们过去使用 `setTimeout`）。
   */
  useIsomorphicLayoutEffect(() => {
    const queueItems = queue.get();

    if (queueItems.length) {
      runQueue(queueItems);

      queue.reset();
    }
  }, [serial]);

  return queue;
}

function createQueue<T>(cb: () => void): Queue<T> {
  let queue: QueueItem<T>[] = [];

  return {
    get: () => queue,
    reset: () => {
      queue = [];
    },
    push: (item) => {
      queue.push(item);
      cb();
    },
  };
}
