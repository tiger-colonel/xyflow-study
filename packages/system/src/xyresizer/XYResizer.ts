import { drag } from 'd3-drag'; // 从 d3-drag 导入拖拽功能
import { select } from 'd3-selection'; // 从 d3-selection 导入选择功能

import { getControlDirection, getDimensionsAfterResize, getResizeDirection } from './utils'; // 导入工具函数：获取控制方向、获取调整大小后的尺寸、获取调整大小的方向
import { getPointerPosition } from '../utils'; // 导入获取指针位置的工具函数
import type {
  CoordinateExtent, // 坐标范围类型
  InternalNodeBase, // 内部节点基础类型
  NodeBase, // 节点基础类型
  NodeLookup, // 节点查找类型
  NodeOrigin, // 节点原点类型
  Transform, // 变换类型
  XYPosition, // XY位置类型
} from '../types';
import type { OnResize, OnResizeEnd, OnResizeStart, ResizeDragEvent, ShouldResize, ControlPosition } from './types'; // 导入调整大小相关的类型

const initPrevValues = { width: 0, height: 0, x: 0, y: 0 }; // 初始化前一个值对象

const initStartValues = {
  ...initPrevValues, // 包含前一个值对象的所有属性
  pointerX: 0, // 指针X坐标
  pointerY: 0, // 指针Y坐标
  aspectRatio: 1, // 宽高比
};

export type XYResizerChange = {
  // 导出XYResizer变更类型
  x?: number; // 可选的x坐标
  y?: number; // 可选的y坐标
  width?: number; // 可选的宽度
  height?: number; // 可选的高度
};

export type XYResizerChildChange = {
  // 导出XYResizer子元素变更类型
  id: string; // 子元素ID
  position: XYPosition; // 子元素位置
  extent?: 'parent' | CoordinateExtent; // 可选的范围
};

type XYResizerParams = {
  // XYResizer参数类型
  domNode: HTMLDivElement; // DOM节点
  nodeId: string; // 节点ID
  getStoreItems: () => {
    // 获取存储项的函数
    nodeLookup: NodeLookup; // 节点查找
    transform: Transform; // 变换
    snapGrid?: [number, number]; // 可选的网格对齐
    snapToGrid: boolean; // 是否对齐到网格
    nodeOrigin: NodeOrigin; // 节点原点
    paneDomNode: HTMLDivElement | null; // 面板DOM节点
  };
  onChange: (changes: XYResizerChange, childChanges: XYResizerChildChange[]) => void; // 变更回调函数
  onEnd?: () => void; // 结束回调函数
};

type XYResizerUpdateParams = {
  // XYResizer更新参数类型
  controlPosition: ControlPosition; // 控制位置
  boundaries: {
    // 边界
    minWidth: number; // 最小宽度
    minHeight: number; // 最小高度
    maxWidth: number; // 最大宽度
    maxHeight: number; // 最大高度
  };
  keepAspectRatio: boolean; // 是否保持宽高比
  onResizeStart: OnResizeStart | undefined; // 调整大小开始回调
  onResize: OnResize | undefined; // 调整大小中回调
  onResizeEnd: OnResizeEnd | undefined; // 调整大小结束回调
  shouldResize: ShouldResize | undefined; // 是否应调整大小的判断函数
};

export type XYResizerInstance = {
  // 导出XYResizer实例类型
  update: (params: XYResizerUpdateParams) => void; // 更新方法
  destroy: () => void; // 销毁方法
};

function nodeToParentExtent(node: NodeBase): CoordinateExtent {
  // 将节点转换为父节点范围的函数
  return [
    [0, 0], // 左上角坐标
    [node.measured!.width!, node.measured!.height!], // 右下角坐标
  ];
}

function nodeToChildExtent(child: NodeBase, parent: NodeBase, nodeOrigin: NodeOrigin): CoordinateExtent {
  // 将节点转换为子节点范围的函数
  const x = parent.position.x + child.position.x; // 计算x坐标
  const y = parent.position.y + child.position.y; // 计算y坐标
  const width = child.measured!.width! ?? 0; // 获取宽度，如果为空则默认为0
  const height = child.measured!.height! ?? 0; // 获取高度，如果为空则默认为0
  const originOffsetX = nodeOrigin[0] * width; // 计算原点x偏移
  const originOffsetY = nodeOrigin[1] * height; // 计算原点y偏移

  return [
    [x - originOffsetX, y - originOffsetY], // 左上角坐标
    [x + width - originOffsetX, y + height - originOffsetY], // 右下角坐标
  ];
}

export function XYResizer({ domNode, nodeId, getStoreItems, onChange, onEnd }: XYResizerParams): XYResizerInstance {
  // 导出XYResizer函数
  const selection = select(domNode); // 选择DOM节点

  function update({
    // 更新函数
    controlPosition,
    boundaries,
    keepAspectRatio,
    onResizeStart,
    onResize,
    onResizeEnd,
    shouldResize,
  }: XYResizerUpdateParams) {
    let prevValues = { ...initPrevValues }; // 初始化前一个值对象
    let startValues = { ...initStartValues }; // 初始化开始值对象

    const controlDirection = getControlDirection(controlPosition); // 获取控制方向

    let node: InternalNodeBase | undefined = undefined; // 声明节点变量
    let containerBounds: DOMRect | null = null; // 声明容器边界变量
    let childNodes: XYResizerChildChange[] = []; // 声明子节点数组
    let parentNode: InternalNodeBase | undefined = undefined; // 声明父节点变量（用于修复expandParent）
    let parentExtent: CoordinateExtent | undefined = undefined; // 声明父节点范围变量
    let childExtent: CoordinateExtent | undefined = undefined; // 声明子节点范围变量

    const dragHandler = drag<HTMLDivElement, unknown>() // 创建拖拽处理器
      .on('start', (event: ResizeDragEvent) => {
        // 开始拖拽事件
        const { nodeLookup, transform, snapGrid, snapToGrid, nodeOrigin, paneDomNode } = getStoreItems(); // 获取存储项
        node = nodeLookup.get(nodeId); // 获取节点

        if (!node) {
          // 如果节点不存在
          return; // 返回
        }

        containerBounds = paneDomNode?.getBoundingClientRect() ?? null; // 获取容器边界
        const { xSnapped, ySnapped } = getPointerPosition(event.sourceEvent, {
          // 获取指针位置
          transform,
          snapGrid,
          snapToGrid,
          containerBounds,
        });

        prevValues = {
          // 设置前一个值
          width: node.measured.width ?? 0, // 宽度
          height: node.measured.height ?? 0, // 高度
          x: node.position.x ?? 0, // x坐标
          y: node.position.y ?? 0, // y坐标
        };

        startValues = {
          // 设置开始值
          ...prevValues, // 包含前一个值的所有属性
          pointerX: xSnapped, // 指针x坐标
          pointerY: ySnapped, // 指针y坐标
          aspectRatio: prevValues.width / prevValues.height, // 宽高比
        };

        parentNode = undefined; // 重置父节点

        if (node.parentId && (node.extent === 'parent' || node.expandParent)) {
          // 如果节点有父ID且范围为parent或expandParent为true
          parentNode = nodeLookup.get(node.parentId); // 获取父节点
          parentExtent = parentNode && node.extent === 'parent' ? nodeToParentExtent(parentNode) : undefined; // 获取父节点范围
        }

        /*
         * 收集所有子节点以在顶部/左侧更改时纠正其相对位置
         * 确定父节点允许调整大小的最大最小范围
         */
        childNodes = []; // 初始化子节点数组
        childExtent = undefined; // 初始化子节点范围

        for (const [childId, child] of nodeLookup) {
          // 遍历所有节点
          if (child.parentId === nodeId) {
            // 如果是当前节点的子节点
            childNodes.push({
              // 添加到子节点数组
              id: childId, // 子节点ID
              position: { ...child.position }, // 子节点位置
              extent: child.extent, // 子节点范围
            });

            if (child.extent === 'parent' || child.expandParent) {
              // 如果子节点范围为parent或expandParent为true
              const extent = nodeToChildExtent(child, node, child.origin ?? nodeOrigin); // 获取子节点范围

              if (childExtent) {
                // 如果已有子节点范围
                childExtent = [
                  // 更新子节点范围
                  [Math.min(extent[0][0], childExtent[0][0]), Math.min(extent[0][1], childExtent[0][1])], // 取最小的左上角坐标
                  [Math.max(extent[1][0], childExtent[1][0]), Math.max(extent[1][1], childExtent[1][1])], // 取最大的右下角坐标
                ];
              } else {
                // 如果没有子节点范围
                childExtent = extent; // 设置子节点范围
              }
            }
          }
        }

        onResizeStart?.(event, { ...prevValues }); // 调用调整大小开始回调
      })
      .on('drag', (event: ResizeDragEvent) => {
        // 拖拽事件
        const { transform, snapGrid, snapToGrid, nodeOrigin: storeNodeOrigin } = getStoreItems(); // 获取存储项

        const pointerPosition = getPointerPosition(event.sourceEvent, {
          // 获取指针位置
          transform,
          snapGrid,
          snapToGrid,
          containerBounds,
        });
        const childChanges: XYResizerChildChange[] = []; // 初始化子节点变更数组

        if (!node) {
          // 如果节点不存在
          return; // 返回
        }
        const { x: prevX, y: prevY, width: prevWidth, height: prevHeight } = prevValues; // 获取前一个值
        const change: XYResizerChange = {}; // 初始化变更对象
        const nodeOrigin = node.origin ?? storeNodeOrigin; // 获取节点原点

        const { width, height, x, y } = getDimensionsAfterResize(
          // 获取调整大小后的尺寸
          startValues,
          controlDirection,
          pointerPosition,
          boundaries,
          keepAspectRatio,
          nodeOrigin,
          parentExtent,
          childExtent
        );

        const isWidthChange = width !== prevWidth; // 是否宽度变化
        const isHeightChange = height !== prevHeight; // 是否高度变化

        const isXPosChange = x !== prevX && isWidthChange; // 是否x坐标变化
        const isYPosChange = y !== prevY && isHeightChange; // 是否y坐标变化

        if (!isXPosChange && !isYPosChange && !isWidthChange && !isHeightChange) {
          // 如果没有变化
          return; // 返回
        }

        if (isXPosChange || isYPosChange || nodeOrigin[0] === 1 || nodeOrigin[1] === 1) {
          // 如果位置变化或原点在右侧或底部
          change.x = isXPosChange ? x : prevValues.x; // 设置x变更
          change.y = isYPosChange ? y : prevValues.y; // 设置y变更

          prevValues.x = change.x; // 更新前一个x值
          prevValues.y = change.y; // 更新前一个y值

          /*
           * 当顶部/左侧改变时，纠正子节点的相对位置
           * 使它们保持在相同的位置
           */
          if (childNodes.length > 0) {
            // 如果有子节点
            const xChange = x - prevX; // 计算x变化量
            const yChange = y - prevY; // 计算y变化量

            for (const childNode of childNodes) {
              // 遍历子节点
              childNode.position = {
                // 更新子节点位置
                x: childNode.position.x - xChange + nodeOrigin[0] * (width - prevWidth), // 计算新的x坐标
                y: childNode.position.y - yChange + nodeOrigin[1] * (height - prevHeight), // 计算新的y坐标
              };
              childChanges.push(childNode); // 添加到子节点变更数组
            }
          }
        }

        if (isWidthChange || isHeightChange) {
          // 如果尺寸变化
          change.width = isWidthChange ? width : prevValues.width; // 设置宽度变更
          change.height = isHeightChange ? height : prevValues.height; // 设置高度变更
          prevValues.width = change.width; // 更新前一个宽度值
          prevValues.height = change.height; // 更新前一个高度值
        }

        // 从顶部/左侧调整大小时修复expandParent
        if (parentNode && node.expandParent) {
          // 如果有父节点且expandParent为true
          const xLimit = nodeOrigin[0] * (change.width ?? 0); // 计算x限制
          if (change.x && change.x < xLimit) {
            // 如果x坐标小于限制
            prevValues.x = xLimit; // 更新前一个x值
            startValues.x = startValues.x - (change.x - xLimit); // 更新开始x值
          }

          const yLimit = nodeOrigin[1] * (change.height ?? 0); // 计算y限制
          if (change.y && change.y < yLimit) {
            // 如果y坐标小于限制
            prevValues.y = yLimit; // 更新前一个y值
            startValues.y = startValues.y - (change.y - yLimit); // 更新开始y值
          }
        }

        const direction = getResizeDirection({
          // 获取调整大小的方向
          width: prevValues.width,
          prevWidth,
          height: prevValues.height,
          prevHeight,
          affectsX: controlDirection.affectsX,
          affectsY: controlDirection.affectsY,
        });

        const nextValues = { ...prevValues, direction }; // 创建下一个值对象

        const callResize = shouldResize?.(event, nextValues); // 判断是否应调整大小

        if (callResize === false) {
          // 如果不应调整大小
          return; // 返回
        }

        onResize?.(event, nextValues); // 调用调整大小中回调
        onChange(change, childChanges); // 调用变更回调
      })
      .on('end', (event: ResizeDragEvent) => {
        // 结束拖拽事件
        onResizeEnd?.(event, { ...prevValues }); // 调用调整大小结束回调
        onEnd?.(); // 调用结束回调
      });
    selection.call(dragHandler); // 将拖拽处理器应用到选择的DOM节点
  }
  function destroy() {
    // 销毁函数
    selection.on('.drag', null); // 移除拖拽事件监听
  }

  return {
    // 返回XYResizer实例
    update, // 更新方法
    destroy, // 销毁方法
  };
}
