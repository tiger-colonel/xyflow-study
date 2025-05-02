/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import type { D3ZoomEvent } from 'd3-zoom';
import { pointer } from 'd3-selection';

import {
  PanOnScrollMode,
  type D3SelectionInstance,
  type D3ZoomHandler,
  type D3ZoomInstance,
  type OnPanZoom,
  type OnDraggingChange,
  type OnTransformChange,
} from '../types';
import { isRightClickPan, isWrappedWithClass, transformToViewport, viewChanged, wheelDelta } from './utils';
import { isMacOs } from '../utils';
import { ZoomPanValues } from './XYPanZoom';

export type PanOnScrollParams = {
  zoomPanValues: ZoomPanValues;
  noWheelClassName: string;
  d3Selection: D3SelectionInstance;
  d3Zoom: D3ZoomInstance;
  panOnScrollMode: PanOnScrollMode;
  panOnScrollSpeed: number;
  zoomOnPinch: boolean;
  onPanZoomStart?: OnPanZoom;
  onPanZoom?: OnPanZoom;
  onPanZoomEnd?: OnPanZoom;
};

export type ZoomOnScrollParams = {
  noWheelClassName: string;
  preventScrolling: boolean;
  d3ZoomHandler: D3ZoomHandler;
};

export type PanZoomStartParams = {
  zoomPanValues: ZoomPanValues;
  onDraggingChange: OnDraggingChange;
  onPanZoomStart?: OnPanZoom;
};

export type PanZoomParams = {
  zoomPanValues: ZoomPanValues;
  panOnDrag: boolean | number[];
  onPaneContextMenu: boolean;
  onTransformChange: OnTransformChange;
  onPanZoom?: OnPanZoom;
};

export type PanZoomEndParams = {
  zoomPanValues: ZoomPanValues;
  panOnDrag: boolean | number[];
  panOnScroll: boolean;
  onDraggingChange: (isDragging: boolean) => void;
  onPanZoomEnd?: OnPanZoom;
  onPaneContextMenu?: (event: any) => void;
};

export function createPanOnScrollHandler({
  zoomPanValues,
  noWheelClassName,
  d3Selection,
  d3Zoom,
  panOnScrollMode,
  panOnScrollSpeed,
  zoomOnPinch,
  onPanZoomStart,
  onPanZoom,
  onPanZoomEnd,
}: PanOnScrollParams) {
  return (event: any) => {
    if (isWrappedWithClass(event, noWheelClassName)) {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const currentZoom = d3Selection.property('__zoom').k || 1;

    // macos sets ctrlKey=true for pinch gesture on a trackpad
    if (event.ctrlKey && zoomOnPinch) {
      const point = pointer(event);
      const pinchDelta = wheelDelta(event);
      const zoom = currentZoom * Math.pow(2, pinchDelta);
      // @ts-ignore
      d3Zoom.scaleTo(d3Selection, zoom, point, event);

      return;
    }

    /*
     * increase scroll speed in firefox
     * firefox: deltaMode === 1; chrome: deltaMode === 0
     */
    const deltaNormalize = event.deltaMode === 1 ? 20 : 1;
    let deltaX = panOnScrollMode === PanOnScrollMode.Vertical ? 0 : event.deltaX * deltaNormalize;
    let deltaY = panOnScrollMode === PanOnScrollMode.Horizontal ? 0 : event.deltaY * deltaNormalize;

    // this enables vertical scrolling with shift + scroll on windows
    if (!isMacOs() && event.shiftKey && panOnScrollMode !== PanOnScrollMode.Vertical) {
      deltaX = event.deltaY * deltaNormalize;
      deltaY = 0;
    }

    d3Zoom.translateBy(
      d3Selection,
      -(deltaX / currentZoom) * panOnScrollSpeed,
      -(deltaY / currentZoom) * panOnScrollSpeed,
      // @ts-ignore
      { internal: true }
    );

    const nextViewport = transformToViewport(d3Selection.property('__zoom'));

    clearTimeout(zoomPanValues.panScrollTimeout);

    /*
     * 对于滚动平移，我们需要自己处理事件调用
     * 我们不能使用 d3-zoom 的 start、zoom 和 end 事件
     * 因为在每次滚动事件中，start 和 move 都会被调用，而不是仅在开始时调用
     */
    if (!zoomPanValues.isPanScrolling) {
      zoomPanValues.isPanScrolling = true;

      onPanZoomStart?.(event, nextViewport);
    }

    if (zoomPanValues.isPanScrolling) {
      onPanZoom?.(event, nextViewport);

      zoomPanValues.panScrollTimeout = setTimeout(() => {
        onPanZoomEnd?.(event, nextViewport);

        zoomPanValues.isPanScrolling = false;
      }, 150);
    }
  };
}

export function createZoomOnScrollHandler({ noWheelClassName, preventScrolling, d3ZoomHandler }: ZoomOnScrollParams) {
  return function (this: Element, event: any, d: unknown) {
    // 即使将 preventScrolling 设置为 false，我们仍然希望启用捏合缩放功能
    const preventZoom = !preventScrolling && event.type === 'wheel' && !event.ctrlKey;

    if (preventZoom || isWrappedWithClass(event, noWheelClassName)) {
      return null;
    }

    event.preventDefault();

    d3ZoomHandler.call(this, event, d);
  };
}

export function createPanZoomStartHandler({ zoomPanValues, onDraggingChange, onPanZoomStart }: PanZoomStartParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    if (event.sourceEvent?.internal) {
      return;
    }

    const viewport = transformToViewport(event.transform);

    // 我们需要在这里记住它，因为在“zoom”事件中它始终为0。
    zoomPanValues.mouseButton = event.sourceEvent?.button || 0;
    zoomPanValues.isZoomingOrPanning = true;
    zoomPanValues.prevViewport = viewport;

    if (event.sourceEvent?.type === 'mousedown') {
      onDraggingChange(true);
    }

    if (onPanZoomStart) {
      onPanZoomStart?.(event.sourceEvent as MouseEvent | TouchEvent, viewport);
    }
  };
}

export function createPanZoomHandler({
  zoomPanValues,
  panOnDrag,
  onPaneContextMenu,
  onTransformChange,
  onPanZoom,
}: PanZoomParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    zoomPanValues.usedRightMouseButton = !!(
      onPaneContextMenu && isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0)
    );

    if (!event.sourceEvent?.sync) {
      onTransformChange([event.transform.x, event.transform.y, event.transform.k]);
    }

    if (onPanZoom && !event.sourceEvent?.internal) {
      onPanZoom?.(event.sourceEvent as MouseEvent | TouchEvent, transformToViewport(event.transform));
    }
  };
}

export function createPanZoomEndHandler({
  zoomPanValues,
  panOnDrag,
  panOnScroll,
  onDraggingChange,
  onPanZoomEnd,
  onPaneContextMenu,
}: PanZoomEndParams) {
  return (event: D3ZoomEvent<HTMLDivElement, any>) => {
    if (event.sourceEvent?.internal) {
      return;
    }

    zoomPanValues.isZoomingOrPanning = false;

    if (
      onPaneContextMenu &&
      isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0) &&
      !zoomPanValues.usedRightMouseButton &&
      event.sourceEvent
    ) {
      onPaneContextMenu(event.sourceEvent);
    }
    zoomPanValues.usedRightMouseButton = false;

    onDraggingChange(false);

    if (onPanZoomEnd && viewChanged(zoomPanValues.prevViewport, event.transform)) {
      const viewport = transformToViewport(event.transform);
      zoomPanValues.prevViewport = viewport;

      clearTimeout(zoomPanValues.timerId);
      zoomPanValues.timerId = setTimeout(
        () => {
          onPanZoomEnd?.(event.sourceEvent as MouseEvent | TouchEvent, viewport);
        },
        // 我们需要为 panOnScroll 设置一个 setTimeout，以抑制滚动期间触发的多个结束事件。
        panOnScroll ? 150 : 0
      );
    }
  };
}
