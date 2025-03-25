import type {
  Dimensions,
  XYPosition,
  CoordinateExtent,
  Box,
  Rect,
  NodeBase,
  NodeOrigin,
  SnapGrid,
  Transform,
  InternalNodeBase,
  NodeLookup,
} from '../types';
import { type Viewport } from '../types';
import { getNodePositionWithOrigin, isInternalNodeBase } from './graph';

/**
 * 将数值限制在给定的最小值和最大值之间
 * @param val - 需要限制的数值
 * @param min - 最小值，默认为0
 * @param max - 最大值，默认为1
 * @returns 限制后的数值
 */
export const clamp = (val: number, min = 0, max = 1): number => Math.min(Math.max(val, min), max);

/**
 * 将位置限制在给定的范围内，考虑元素尺寸
 * @param position - 需要限制的位置坐标，默认为{x: 0, y: 0}
 * @param extent - 坐标的边界范围
 * @param dimensions - 元素的尺寸
 * @returns 限制后的位置坐标
 */
export const clampPosition = (
  position: XYPosition = { x: 0, y: 0 }, // 默认位置为原点
  extent: CoordinateExtent, // 坐标边界
  dimensions: Partial<Dimensions> // 元素尺寸
) => ({
  x: clamp(position.x, extent[0][0], extent[1][0] - (dimensions?.width ?? 0)), // 限制x坐标在边界内，考虑元素宽度
  y: clamp(position.y, extent[0][1], extent[1][1] - (dimensions?.height ?? 0)), // 限制y坐标在边界内，考虑元素高度
});

/**
 * 将子节点位置限制在父节点范围内
 * @param childPosition - 子节点位置
 * @param childDimensions - 子节点尺寸
 * @param parent - 父节点
 * @returns 限制后的子节点位置
 */
export function clampPositionToParent<NodeType extends NodeBase>(
  childPosition: XYPosition, // 子节点位置
  childDimensions: Dimensions, // 子节点尺寸
  parent: InternalNodeBase<NodeType> // 父节点
) {
  const { width: parentWidth, height: parentHeight } = getNodeDimensions(parent); // 获取父节点尺寸
  const { x: parentX, y: parentY } = parent.internals.positionAbsolute; // 获取父节点绝对位置

  return clampPosition(
    childPosition, // 子节点位置
    [
      [parentX, parentY], // 父节点左上角坐标
      [parentX + parentWidth, parentY + parentHeight], // 父节点右下角坐标
    ],
    childDimensions // 子节点尺寸
  );
}

/**
 * 计算当鼠标靠近画布边缘时的平移速度
 * @internal
 * @param value - 鼠标的一维位置（x或y）
 * @param min - 开始平移的最小画布位置
 * @param max - 开始平移的最大画布位置
 * @returns - 一个0到1之间的数字，表示平移的速度
 */
const calcAutoPanVelocity = (value: number, min: number, max: number): number => {
  if (value < min) {
    // 当鼠标位置小于最小边界时，向正方向移动
    return clamp(Math.abs(value - min), 1, min) / min;
  } else if (value > max) {
    // 当鼠标位置大于最大边界时，向负方向移动
    return -clamp(Math.abs(value - max), 1, min) / min;
  }

  return 0; // 鼠标在边界内，不需要自动平移
};

/**
 * 计算自动平移的移动量
 * @param pos - 当前位置
 * @param bounds - 边界尺寸
 * @param speed - 移动速度，默认为15
 * @param distance - 触发自动平移的边缘距离，默认为40
 * @returns 包含x和y方向移动量的数组
 */
export const calcAutoPan = (
  pos: XYPosition, // 当前位置
  bounds: Dimensions, // 边界尺寸
  speed: number = 15, // 平移速度
  distance: number = 40 // 边缘检测距离
): number[] => {
  const xMovement = calcAutoPanVelocity(pos.x, distance, bounds.width - distance) * speed; // 计算x方向移动速度并乘以速度系数
  const yMovement = calcAutoPanVelocity(pos.y, distance, bounds.height - distance) * speed; // 计算y方向移动速度并乘以速度系数

  return [xMovement, yMovement]; // 返回x和y方向的移动量
};

/**
 * 获取两个Box的边界范围
 * @param box1 - 第一个Box
 * @param box2 - 第二个Box
 * @returns 包含两个Box的最小Box
 */
export const getBoundsOfBoxes = (box1: Box, box2: Box): Box => ({
  x: Math.min(box1.x, box2.x), // 取两个Box左上角x坐标的最小值
  y: Math.min(box1.y, box2.y), // 取两个Box左上角y坐标的最小值
  x2: Math.max(box1.x2, box2.x2), // 取两个Box右下角x坐标的最大值
  y2: Math.max(box1.y2, box2.y2), // 取两个Box右下角y坐标的最大值
});

/**
 * 将矩形转换为Box格式
 * @param param0 - 矩形参数，包含x, y, width, height
 * @returns 转换后的Box对象
 */
export const rectToBox = ({ x, y, width, height }: Rect): Box => ({
  x, // 左上角x坐标
  y, // 左上角y坐标
  x2: x + width, // 右下角x坐标 = 左上角x + 宽度
  y2: y + height, // 右下角y坐标 = 左上角y + 高度
});

/**
 * 将Box转换为矩形格式
 * @param param0 - Box参数，包含x, y, x2, y2
 * @returns 转换后的矩形对象
 */
export const boxToRect = ({ x, y, x2, y2 }: Box): Rect => ({
  x, // 左上角x坐标
  y, // 左上角y坐标
  width: x2 - x, // 宽度 = 右下角x - 左上角x
  height: y2 - y, // 高度 = 右下角y - 左上角y
});

/**
 * 将节点转换为矩形格式
 * @param node - 节点对象
 * @param nodeOrigin - 节点原点，默认为[0, 0]
 * @returns 表示节点的矩形对象
 */
export const nodeToRect = (node: InternalNodeBase | NodeBase, nodeOrigin: NodeOrigin = [0, 0]): Rect => {
  // 获取节点的位置坐标
  const { x, y } = isInternalNodeBase(node)
    ? node.internals.positionAbsolute // 如果是内部节点，使用绝对位置
    : getNodePositionWithOrigin(node, nodeOrigin); // 否则，使用基于原点的位置

  return {
    x, // 矩形左上角x坐标
    y, // 矩形左上角y坐标
    // 优先使用测量宽度，然后是指定宽度，再是初始宽度，最后默认为0
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
    // 优先使用测量高度，然后是指定高度，再是初始高度，最后默认为0
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0,
  };
};

/**
 * 将节点转换为Box格式
 * @param node - 节点对象
 * @param nodeOrigin - 节点原点，默认为[0, 0]
 * @returns 表示节点的Box对象
 */
export const nodeToBox = (node: InternalNodeBase | NodeBase, nodeOrigin: NodeOrigin = [0, 0]): Box => {
  // 获取节点的位置坐标
  const { x, y } = isInternalNodeBase(node)
    ? node.internals.positionAbsolute // 如果是内部节点，使用绝对位置
    : getNodePositionWithOrigin(node, nodeOrigin); // 否则，使用基于原点的位置

  return {
    x, // Box左上角x坐标
    y, // Box左上角y坐标
    // 右下角x坐标 = 左上角x + 宽度
    x2: x + (node.measured?.width ?? node.width ?? node.initialWidth ?? 0),
    // 右下角y坐标 = 左上角y + 高度
    y2: y + (node.measured?.height ?? node.height ?? node.initialHeight ?? 0),
  };
};

/**
 * 获取两个矩形的边界范围
 * @param rect1 - 第一个矩形
 * @param rect2 - 第二个矩形
 * @returns 包含两个矩形的最小矩形
 */
export const getBoundsOfRects = (rect1: Rect, rect2: Rect): Rect =>
  boxToRect(getBoundsOfBoxes(rectToBox(rect1), rectToBox(rect2))); // 先转换为Box，计算边界，再转回矩形

/**
 * 计算两个矩形的重叠面积
 * @param rectA - 第一个矩形
 * @param rectB - 第二个矩形
 * @returns 重叠的面积
 */
export const getOverlappingArea = (rectA: Rect, rectB: Rect): number => {
  // 计算x轴重叠长度：两个矩形右边界的最小值减去两个矩形左边界的最大值
  const xOverlap = Math.max(0, Math.min(rectA.x + rectA.width, rectB.x + rectB.width) - Math.max(rectA.x, rectB.x));
  // 计算y轴重叠长度：两个矩形下边界的最小值减去两个矩形上边界的最大值
  const yOverlap = Math.max(0, Math.min(rectA.y + rectA.height, rectB.y + rectB.height) - Math.max(rectA.y, rectB.y));

  return Math.ceil(xOverlap * yOverlap); // 向上取整计算重叠面积
};

/**
 * 检查对象是否为矩形
 * @param obj - 要检查的对象
 * @returns 布尔值，表示对象是否为矩形
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isRectObject = (obj: any): obj is Rect =>
  // 检查width、height、x和y属性是否都是数字
  isNumeric(obj.width) && isNumeric(obj.height) && isNumeric(obj.x) && isNumeric(obj.y);

/**
 * 检查值是否为数字
 * @param n - 要检查的值
 * @returns 布尔值，表示值是否为有效数字
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export const isNumeric = (n: any): n is number => !isNaN(n) && isFinite(n); // 不是NaN且是有限数

// 用于节点和边的无障碍键盘控制

/**
 * 开发模式下的警告函数
 * @param id - 错误ID
 * @param message - 警告消息
 */
export const devWarn = (id: string, message: string) => {
  if (process.env.NODE_ENV === 'development') {
    // 仅在开发环境下显示警告
    console.warn(`[React Flow]: ${message} 帮助: https://reactflow.dev/error#${id}`); // 输出带有帮助链接的警告
  }
};

/**
 * 将位置对齐到网格
 * @param position - 原始位置
 * @param snapGrid - 网格尺寸，默认为[1, 1]
 * @returns 对齐到网格的位置
 */
export const snapPosition = (position: XYPosition, snapGrid: SnapGrid = [1, 1]): XYPosition => {
  return {
    x: snapGrid[0] * Math.round(position.x / snapGrid[0]), // 将x坐标对齐到网格
    y: snapGrid[1] * Math.round(position.y / snapGrid[1]), // 将y坐标对齐到网格
  };
};

/**
 * 将屏幕坐标转换为渲染器坐标
 * @param param0 - 屏幕坐标
 * @param param1 - 变换参数[平移x, 平移y, 缩放]
 * @param snapToGrid - 是否对齐到网格，默认为false
 * @param snapGrid - 网格尺寸，默认为[1, 1]
 * @returns 渲染器坐标
 */
export const pointToRendererPoint = (
  { x, y }: XYPosition, // 屏幕坐标
  [tx, ty, tScale]: Transform, // 变换参数
  snapToGrid = false, // 是否对齐到网格
  snapGrid: SnapGrid = [1, 1] // 网格尺寸
): XYPosition => {
  const position: XYPosition = {
    x: (x - tx) / tScale, // 逆变换x坐标
    y: (y - ty) / tScale, // 逆变换y坐标
  };

  return snapToGrid ? snapPosition(position, snapGrid) : position; // 如果需要对齐到网格，则对齐
};

/**
 * 将渲染器坐标转换为屏幕坐标
 * @param param0 - 渲染器坐标
 * @param param1 - 变换参数[平移x, 平移y, 缩放]
 * @returns 屏幕坐标
 */
export const rendererPointToPoint = ({ x, y }: XYPosition, [tx, ty, tScale]: Transform): XYPosition => {
  return {
    x: x * tScale + tx, // 应用变换到x坐标
    y: y * tScale + ty, // 应用变换到y坐标
  };
};

/**
 * 返回一个包含给定边界的视口，可选择添加内边距。
 * @public
 * @remarks 您可以使用 {@link getNodesBounds} 和 {@link getBoundsOfRects} 确定节点的边界
 * @param bounds - 要适配进视口的边界
 * @param width - 视口的宽度
 * @param height - 视口的高度
 * @param minZoom - 结果视口的最小缩放级别
 * @param maxZoom - 结果视口的最大缩放级别
 * @param padding - 边界周围的可选内边距
 * @returns 一个转换后的 {@link Viewport}，它包含给定的边界，您可以将其传递给如 {@link setViewport} 的函数
 * @example
 * const { x, y, zoom } = getViewportForBounds(
 *{ x: 0, y: 0, width: 100, height: 100},
 *1200, 800, 0.5, 2);
 */
export const getViewportForBounds = (
  bounds: Rect, // 要适配的边界
  width: number, // 视口宽度
  height: number, // 视口高度
  minZoom: number, // 最小缩放级别
  maxZoom: number, // 最大缩放级别
  padding: number // 内边距
): Viewport => {
  const xZoom = width / (bounds.width * (1 + padding)); // 基于宽度计算缩放级别
  const yZoom = height / (bounds.height * (1 + padding)); // 基于高度计算缩放级别
  const zoom = Math.min(xZoom, yZoom); // 取最小缩放级别，确保所有内容可见
  const clampedZoom = clamp(zoom, minZoom, maxZoom); // 限制缩放级别在指定范围内
  const boundsCenterX = bounds.x + bounds.width / 2; // 计算边界中心的x坐标
  const boundsCenterY = bounds.y + bounds.height / 2; // 计算边界中心的y坐标
  const x = width / 2 - boundsCenterX * clampedZoom; // 计算平移的x坐标，使边界居中
  const y = height / 2 - boundsCenterY * clampedZoom; // 计算平移的y坐标，使边界居中

  return { x, y, zoom: clampedZoom }; // 返回视口配置
};

/**
 * 检测当前环境是否为MacOS
 * @returns 布尔值，表示是否为MacOS环境
 */
export const isMacOs = () => typeof navigator !== 'undefined' && navigator?.userAgent?.indexOf('Mac') >= 0;

/**
 * 检查边界范围是否为坐标范围类型
 * @param extent - 边界范围
 * @returns 布尔值，表示是否为坐标范围类型
 */
export function isCoordinateExtent(extent?: CoordinateExtent | 'parent'): extent is CoordinateExtent {
  return extent !== undefined && extent !== 'parent'; // 不是undefined且不是'parent'字符串
}

/**
 * 获取节点的尺寸
 * @param node - 节点对象
 * @returns 包含宽度和高度的对象
 */
export function getNodeDimensions(node: {
  measured?: { width?: number; height?: number }; // 测量的尺寸
  width?: number; // 节点宽度
  height?: number; // 节点高度
  initialWidth?: number; // 初始宽度
  initialHeight?: number; // 初始高度
}): { width: number; height: number } {
  return {
    // 优先使用测量宽度，然后是指定宽度，再是初始宽度，最后默认为0
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
    // 优先使用测量高度，然后是指定高度，再是初始高度，最后默认为0
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0,
  };
}

/**
 * 检查节点是否具有有效尺寸
 * @param node - 节点对象
 * @returns 布尔值，表示节点是否有有效尺寸
 */
export function nodeHasDimensions<NodeType extends NodeBase = NodeBase>(node: NodeType): boolean {
  return (
    // 检查节点是否有宽度（测量宽度、指定宽度或初始宽度）
    (node.measured?.width ?? node.width ?? node.initialWidth) !== undefined &&
    // 检查节点是否有高度（测量高度、指定高度或初始高度）
    (node.measured?.height ?? node.height ?? node.initialHeight) !== undefined
  );
}

/**
 * 将子节点位置转换为绝对位置
 *
 * @internal
 * @param position - 相对位置
 * @param dimensions - 节点尺寸
 * @param parentId - 父节点ID
 * @param nodeLookup - 节点查找表
 * @param nodeOrigin - 节点原点
 * @returns 绝对位置
 */
export function evaluateAbsolutePosition(
  position: XYPosition, // 相对位置
  dimensions: { width?: number; height?: number } = { width: 0, height: 0 }, // 节点尺寸
  parentId: string, // 父节点ID
  nodeLookup: NodeLookup, // 节点查找表
  nodeOrigin: NodeOrigin // 节点原点
): XYPosition {
  const positionAbsolute = { ...position }; // 克隆位置对象

  const parent = nodeLookup.get(parentId); // 获取父节点
  if (parent) {
    const origin = parent.origin || nodeOrigin; // 使用父节点原点或默认原点
    // 计算x方向绝对位置：父节点绝对位置 + 子节点相对位置 - 基于原点的偏移量
    positionAbsolute.x += parent.internals.positionAbsolute.x - (dimensions.width ?? 0) * origin[0];
    // 计算y方向绝对位置：父节点绝对位置 + 子节点相对位置 - 基于原点的偏移量
    positionAbsolute.y += parent.internals.positionAbsolute.y - (dimensions.height ?? 0) * origin[1];
  }

  return positionAbsolute; // 返回计算后的绝对位置
}

/**
 * 比较两个字符串集合是否相等
 * @param a - 第一个集合
 * @param b - 第二个集合
 * @returns 布尔值，表示两个集合是否相等
 */
export function areSetsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) {
    return false; // 如果大小不同，集合不相等
  }

  for (const item of a) {
    if (!b.has(item)) {
      return false; // 如果a中的元素不存在于b中，集合不相等
    }
  }

  return true; // 所有检查都通过，集合相等
}
