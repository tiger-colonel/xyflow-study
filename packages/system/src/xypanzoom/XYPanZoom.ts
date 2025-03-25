// 导入d3-zoom中的ZoomTransform类型和zoom、zoomTransform函数
import { type ZoomTransform, zoom, zoomTransform } from 'd3-zoom';
// 导入d3-selection中的select函数
import { select } from 'd3-selection';

// 从../types中导入多个类型和接口
import {
  type CoordinateExtent,
  type Viewport,
  PanZoomTransformOptions,
  PanZoomUpdateOptions,
  PanZoomParams,
  PanZoomInstance,
} from '../types';
// 从../utils中导入工具函数
import { clamp, isNumeric } from '../utils';
// 从./utils中导入工具函数
import { getD3Transition, viewportToTransform, wheelDelta } from './utils';
// 从./eventhandler中导入事件处理器创建函数
import {
  createPanOnScrollHandler,
  createPanZoomEndHandler,
  createPanZoomHandler,
  createPanZoomStartHandler,
  createZoomOnScrollHandler,
} from './eventhandler';
// 从./filter中导入过滤器创建函数
import { createFilter } from './filter';

// 定义ZoomPanValues类型，用于存储平移缩放的状态值
export type ZoomPanValues = {
  isZoomingOrPanning: boolean; // 是否正在缩放或平移
  usedRightMouseButton: boolean; // 是否使用了鼠标右键
  prevViewport: Viewport; // 先前的视口状态
  mouseButton: number; // 使用的鼠标按钮
  timerId: ReturnType<typeof setTimeout> | undefined; // 定时器ID
  panScrollTimeout: ReturnType<typeof setTimeout> | undefined; // 平移滚动超时
  isPanScrolling: boolean; // 是否正在平移滚动
};

// 导出XYPanZoom函数，创建平移缩放实例
export function XYPanZoom({
  domNode,
  minZoom,
  maxZoom,
  paneClickDistance,
  translateExtent,
  viewport,
  onPanZoom,
  onPanZoomStart,
  onPanZoomEnd,
  onDraggingChange,
}: PanZoomParams): PanZoomInstance {
  // 初始化缩放平移值对象
  const zoomPanValues: ZoomPanValues = {
    isZoomingOrPanning: false,
    usedRightMouseButton: false,
    prevViewport: { x: 0, y: 0, zoom: 0 },
    mouseButton: 0,
    timerId: undefined,
    panScrollTimeout: undefined,
    isPanScrolling: false,
  };
  // 获取DOM节点的边界矩形
  const bbox = domNode.getBoundingClientRect();
  // 创建d3缩放实例并配置
  const d3ZoomInstance = zoom()
    .clickDistance(!isNumeric(paneClickDistance) || paneClickDistance < 0 ? 0 : paneClickDistance)
    .scaleExtent([minZoom, maxZoom])
    .translateExtent(translateExtent);
  // 将d3缩放实例应用到DOM节点
  const d3Selection = select(domNode).call(d3ZoomInstance);

  // 设置受约束的视口
  setViewportConstrained(
    {
      x: viewport.x,
      y: viewport.y,
      zoom: clamp(viewport.zoom, minZoom, maxZoom),
    },
    [
      [0, 0],
      [bbox.width, bbox.height],
    ],
    translateExtent
  );

  // 获取d3的默认滚轮事件处理器
  const d3ZoomHandler = d3Selection.on('wheel.zoom')!;
  // 获取d3的默认双击缩放事件处理器
  const d3DblClickZoomHandler = d3Selection.on('dblclick.zoom')!;
  // 设置滚轮增量计算函数
  d3ZoomInstance.wheelDelta(wheelDelta);

  // 设置变换函数
  function setTransform(transform: ZoomTransform, options?: PanZoomTransformOptions) {
    if (d3Selection) {
      return new Promise<boolean>((resolve) => {
        d3ZoomInstance?.transform(
          getD3Transition(d3Selection, options?.duration, () => resolve(true)),
          transform
        );
      });
    }

    return Promise.resolve(false);
  }

  // 公共函数
  // 更新配置函数
  function update({
    noWheelClassName,
    noPanClassName,
    onPaneContextMenu,
    userSelectionActive,
    panOnScroll,
    panOnDrag,
    panOnScrollMode,
    panOnScrollSpeed,
    preventScrolling,
    zoomOnPinch,
    zoomOnScroll,
    zoomOnDoubleClick,
    zoomActivationKeyPressed,
    lib,
    onTransformChange,
  }: PanZoomUpdateOptions) {
    if (userSelectionActive && !zoomPanValues.isZoomingOrPanning) {
      destroy();
    }

    // 判断是否应该启用滚动平移
    const isPanOnScroll = panOnScroll && !zoomActivationKeyPressed && !userSelectionActive;

    // 创建滚轮处理器，根据条件判断使用平移或缩放
    const wheelHandler = isPanOnScroll
      ? createPanOnScrollHandler({
          zoomPanValues,
          noWheelClassName,
          d3Selection,
          d3Zoom: d3ZoomInstance,
          panOnScrollMode,
          panOnScrollSpeed,
          zoomOnPinch,
          onPanZoomStart,
          onPanZoom,
          onPanZoomEnd,
        })
      : createZoomOnScrollHandler({
          noWheelClassName,
          preventScrolling,
          d3ZoomHandler,
        });

    // 设置滚轮事件处理器
    d3Selection.on('wheel.zoom', wheelHandler, { passive: false });

    if (!userSelectionActive) {
      // 平移缩放开始处理
      const startHandler = createPanZoomStartHandler({
        zoomPanValues,
        onDraggingChange,
        onPanZoomStart,
      });
      d3ZoomInstance.on('start', startHandler);

      // 平移缩放处理
      const panZoomHandler = createPanZoomHandler({
        zoomPanValues,
        panOnDrag,
        onPaneContextMenu: !!onPaneContextMenu,
        onPanZoom,
        onTransformChange,
      });
      d3ZoomInstance.on('zoom', panZoomHandler);

      // 平移缩放结束处理
      const panZoomEndHandler = createPanZoomEndHandler({
        zoomPanValues,
        panOnDrag,
        panOnScroll,
        onPaneContextMenu,
        onPanZoomEnd,
        onDraggingChange,
      });
      d3ZoomInstance.on('end', panZoomEndHandler);
    }

    // 创建事件过滤器
    const filter = createFilter({
      zoomActivationKeyPressed,
      panOnDrag,
      zoomOnScroll,
      panOnScroll,
      zoomOnDoubleClick,
      zoomOnPinch,
      userSelectionActive,
      noPanClassName,
      noWheelClassName,
      lib,
    });
    d3ZoomInstance.filter(filter);

    /*
     * 我们不能将zoomOnDoubleClick添加到上面的过滤器中，因为
     * 在触摸屏上双击会绕过过滤器，并且
     * dblclick.zoom直接在selection上触发
     */
    if (zoomOnDoubleClick) {
      d3Selection.on('dblclick.zoom', d3DblClickZoomHandler);
    } else {
      d3Selection.on('dblclick.zoom', null);
    }
  }

  // 销毁函数，移除zoom事件监听
  function destroy() {
    d3ZoomInstance.on('zoom', null);
  }

  // 设置受约束的视口函数
  async function setViewportConstrained(
    viewport: Viewport,
    extent: CoordinateExtent,
    translateExtent: CoordinateExtent
  ): Promise<ZoomTransform | undefined> {
    // 将视口转换为变换
    const nextTransform = viewportToTransform(viewport);
    // 应用约束
    const contrainedTransform = d3ZoomInstance?.constrain()(nextTransform, extent, translateExtent);

    if (contrainedTransform) {
      await setTransform(contrainedTransform);
    }

    return new Promise((resolve) => resolve(contrainedTransform));
  }

  // 设置视口函数
  async function setViewport(viewport: Viewport, options?: PanZoomTransformOptions) {
    const nextTransform = viewportToTransform(viewport);

    await setTransform(nextTransform, options);

    return new Promise<ZoomTransform>((resolve) => resolve(nextTransform));
  }

  // 同步视口函数
  function syncViewport(viewport: Viewport) {
    if (d3Selection) {
      const nextTransform = viewportToTransform(viewport);
      const currentTransform = d3Selection.property('__zoom');

      if (
        currentTransform.k !== viewport.zoom ||
        currentTransform.x !== viewport.x ||
        currentTransform.y !== viewport.y
      ) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        d3ZoomInstance?.transform(d3Selection, nextTransform, null, { sync: true });
      }
    }
  }

  // 获取当前视口函数
  function getViewport(): Viewport {
    const transform = d3Selection ? zoomTransform(d3Selection.node() as Element) : { x: 0, y: 0, k: 1 };
    return { x: transform.x, y: transform.y, zoom: transform.k };
  }

  // 缩放到指定比例函数
  function scaleTo(zoom: number, options?: PanZoomTransformOptions) {
    if (d3Selection) {
      return new Promise<boolean>((resolve) => {
        d3ZoomInstance?.scaleTo(
          getD3Transition(d3Selection, options?.duration, () => resolve(true)),
          zoom
        );
      });
    }

    return Promise.resolve(false);
  }

  // 按因子缩放函数
  function scaleBy(factor: number, options?: PanZoomTransformOptions) {
    if (d3Selection) {
      return new Promise<boolean>((resolve) => {
        d3ZoomInstance?.scaleBy(
          getD3Transition(d3Selection, options?.duration, () => resolve(true)),
          factor
        );
      });
    }

    return Promise.resolve(false);
  }

  // 设置缩放范围函数
  function setScaleExtent(scaleExtent: [number, number]) {
    d3ZoomInstance?.scaleExtent(scaleExtent);
  }

  // 设置平移范围函数
  function setTranslateExtent(translateExtent: CoordinateExtent) {
    d3ZoomInstance?.translateExtent(translateExtent);
  }

  // 设置点击距离函数
  function setClickDistance(distance: number) {
    const validDistance = !isNumeric(distance) || distance < 0 ? 0 : distance;
    d3ZoomInstance?.clickDistance(validDistance);
  }

  // 返回平移缩放实例对象
  return {
    update,
    destroy,
    setViewport,
    setViewportConstrained,
    getViewport,
    scaleTo,
    scaleBy,
    setScaleExtent,
    setTranslateExtent,
    syncViewport,
    setClickDistance,
  };
}
