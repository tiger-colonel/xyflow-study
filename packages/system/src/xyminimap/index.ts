/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { type D3ZoomEvent, zoom } from 'd3-zoom';
import { select, pointer } from 'd3-selection';

import type { CoordinateExtent, PanZoomInstance, Transform } from '../types';

export type XYMinimapInstance = {
  update: (params: XYMinimapUpdate) => void;
  destroy: () => void;
  pointer: typeof pointer;
};

export type XYMinimapParams = {
  panZoom: PanZoomInstance;
  domNode: Element;
  getTransform: () => Transform;
  getViewScale: () => number;
};

export type XYMinimapUpdate = {
  translateExtent: CoordinateExtent;
  width: number;
  height: number;
  inversePan?: boolean;
  zoomStep?: number;
  pannable?: boolean;
  zoomable?: boolean;
};

export function XYMinimap({ domNode, panZoom, getTransform, getViewScale }: XYMinimapParams) {
  // 使用d3-selection的select方法选择DOM节点
  const selection = select(domNode);

  // 更新小地图的函数，接收配置参数
  function update({
    translateExtent, // 平移范围限制
    width, // 小地图宽度
    height, // 小地图高度
    zoomStep = 10, // 缩放步长，默认为10
    pannable = true, // 是否可平移，默认为true
    zoomable = true, // 是否可缩放，默认为true
    inversePan = false, // 是否反转平移方向，默认为false
  }: XYMinimapUpdate) {
    // 处理缩放事件的函数
    const zoomHandler = (event: D3ZoomEvent<SVGSVGElement, any>) => {
      // 获取当前变换状态
      const transform = getTransform();

      // 如果不是滚轮事件或没有panZoom实例，则直接返回
      if (event.sourceEvent.type !== 'wheel' || !panZoom) {
        return;
      }

      // 计算缩放增量值，根据不同的deltaMode调整系数
      const pinchDelta =
        -event.sourceEvent.deltaY *
        (event.sourceEvent.deltaMode === 1 ? 0.05 : event.sourceEvent.deltaMode ? 1 : 0.002) *
        zoomStep;
      // 计算新的缩放级别
      const nextZoom = transform[2] * Math.pow(2, pinchDelta);

      // 应用新的缩放级别到主视图
      panZoom.scaleTo(nextZoom);
    };

    // 初始化平移起始位置
    let panStart = [0, 0];
    // 处理平移开始事件的函数
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panStartHandler = (event: D3ZoomEvent<HTMLDivElement, any>) => {
      // 当鼠标按下或触摸开始时，记录起始位置
      if (event.sourceEvent.type === 'mousedown' || event.sourceEvent.type === 'touchstart') {
        panStart = [
          event.sourceEvent.clientX ?? event.sourceEvent.touches[0].clientX,
          event.sourceEvent.clientY ?? event.sourceEvent.touches[0].clientY,
        ];
      }
    };

    // 处理平移移动事件的函数
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panHandler = (event: D3ZoomEvent<HTMLDivElement, any>) => {
      // 获取当前变换状态
      const transform = getTransform();

      // 如果不是鼠标移动或触摸移动事件，或没有panZoom实例，则直接返回
      if ((event.sourceEvent.type !== 'mousemove' && event.sourceEvent.type !== 'touchmove') || !panZoom) {
        return;
      }

      // 获取当前指针位置
      const panCurrent = [
        event.sourceEvent.clientX ?? event.sourceEvent.touches[0].clientX,
        event.sourceEvent.clientY ?? event.sourceEvent.touches[0].clientY,
      ];
      // 计算位置变化量
      const panDelta = [panCurrent[0] - panStart[0], panCurrent[1] - panStart[1]];
      // 更新起始位置为当前位置，为下次计算做准备
      panStart = panCurrent;

      // 计算移动比例，考虑视图缩放和变换缩放，可能根据inversePan反转方向
      const moveScale = getViewScale() * Math.max(transform[2], Math.log(transform[2])) * (inversePan ? -1 : 1);
      // 计算新位置
      const position = {
        x: transform[0] - panDelta[0] * moveScale,
        y: transform[1] - panDelta[1] * moveScale,
      };
      // 设置视图边界
      const extent: CoordinateExtent = [
        [0, 0],
        [width, height],
      ];

      // 应用新的视图约束到主视图
      panZoom.setViewportConstrained(
        {
          x: position.x,
          y: position.y,
          zoom: transform[2],
        },
        extent,
        translateExtent
      );
    };

    // 创建d3缩放和平移处理器
    const zoomAndPanHandler = zoom()
      .on('start', panStartHandler) // 绑定开始事件处理器
      // 根据pannable参数决定是否启用平移功能
      // @ts-ignore
      .on('zoom', pannable ? panHandler : null)
      // 根据zoomable参数决定是否启用缩放功能
      // @ts-ignore
      .on('zoom.wheel', zoomable ? zoomHandler : null);

    // 将处理器应用到DOM节点
    selection.call(zoomAndPanHandler, {});
  }

  // 销毁小地图的函数，移除事件监听
  function destroy() {
    selection.on('zoom', null);
  }

  // 返回小地图实例对象，包含更新、销毁方法和pointer引用
  return {
    update,
    destroy,
    pointer,
  };
}
