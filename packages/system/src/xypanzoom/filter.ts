/* eslint-disable @typescript-eslint/no-explicit-any */
import { isWrappedWithClass } from './utils';

export type FilterParams = {
  zoomActivationKeyPressed: boolean;
  zoomOnScroll: boolean;
  zoomOnPinch: boolean;
  panOnDrag: boolean | number[];
  panOnScroll: boolean;
  zoomOnDoubleClick: boolean;
  userSelectionActive: boolean;
  noWheelClassName: string;
  noPanClassName: string;
  lib: string;
};

export function createFilter({
  zoomActivationKeyPressed,
  zoomOnScroll,
  zoomOnPinch,
  panOnDrag,
  panOnScroll,
  zoomOnDoubleClick,
  userSelectionActive,
  noWheelClassName,
  noPanClassName,
  lib,
}: FilterParams) {
  return (event: any): boolean => {
    const zoomScroll = zoomActivationKeyPressed || zoomOnScroll;
    const pinchZoom = zoomOnPinch && event.ctrlKey;

    if (
      event.button === 1 &&
      event.type === 'mousedown' &&
      (isWrappedWithClass(event, `${lib}-flow__node`) || isWrappedWithClass(event, `${lib}-flow__edge`))
    ) {
      return true;
    }

    // 如果禁用了所有交互，我们将阻止所有缩放事件
    if (!panOnDrag && !zoomScroll && !panOnScroll && !zoomOnDoubleClick && !zoomOnPinch) {
      return false;
    }

    // 在选择期间，我们阻止所有其他交互。
    if (userSelectionActive) {
      return false;
    }

    // 如果目标元素位于具有 nowheel 类的元素内，我们将阻止缩放。
    if (isWrappedWithClass(event, noWheelClassName) && event.type === 'wheel') {
      return false;
    }

    // if the target element is inside an element with the nopan class, we prevent panning
    if (
      isWrappedWithClass(event, noPanClassName) &&
      (event.type !== 'wheel' || (panOnScroll && event.type === 'wheel' && !zoomActivationKeyPressed))
    ) {
      return false;
    }

    if (!zoomOnPinch && event.ctrlKey && event.type === 'wheel') {
      return false;
    }

    if (!zoomOnPinch && event.type === 'touchstart' && event.touches?.length > 1) {
      event.preventDefault(); // if you manage to start with 2 touches, we prevent native zoom
      return false;
    }

    // when there is no scroll handling enabled, we prevent all wheel events
    if (!zoomScroll && !panOnScroll && !pinchZoom && event.type === 'wheel') {
      return false;
    }

    // if the pane is not movable, we prevent dragging it with mousestart or touchstart
    if (!panOnDrag && (event.type === 'mousedown' || event.type === 'touchstart')) {
      return false;
    }

    // if the pane is only movable using allowed clicks
    if (Array.isArray(panOnDrag) && !panOnDrag.includes(event.button) && event.type === 'mousedown') {
      return false;
    }

    // We only allow right clicks if pan on drag is set to right click
    const buttonAllowed =
      (Array.isArray(panOnDrag) && panOnDrag.includes(event.button)) || !event.button || event.button <= 1;

    // default filter for d3-zoom
    return (!event.ctrlKey || event.type === 'wheel') && buttonAllowed;
  };
}
