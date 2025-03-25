/**
 * 虽然 [`PanelPosition`](/api-reference/types/panel-position) 可以用于将组件
 * 放置在容器的角落，但 `Position` 枚举的精确度较低，主要用于边缘和连接点的相关场景。
 *
 * @public
 */
export enum Position {
  Left = 'left',
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
}

export const oppositePosition = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
};

/**
 * 所有位置都存储在具有 x 和 y 坐标的对象中。
 *
 * @public
 */
export type XYPosition = {
  x: number;
  y: number;
};

export type XYZPosition = XYPosition & { z: number };

export type Dimensions = {
  width: number;
  height: number;
};

export type Rect = Dimensions & XYPosition;

export type Box = XYPosition & {
  x2: number;
  y2: number;
};

export type Transform = [number, number, number];

/**
 * 坐标范围表示坐标系中的两个点：一个在左上角，一个在右下角。它用于表示
 * 流程中节点的边界或视口的边界。
 *
 * @public
 *
 * @remarks 需要 `CoordinateExtent` 的属性通常默认为 `[[-∞, -∞], [+∞, +∞]]`，
 * 表示无边界的范围。
 */
export type CoordinateExtent = [[number, number], [number, number]];
