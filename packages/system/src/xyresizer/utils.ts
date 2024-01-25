import { CoordinateExtent } from '../types';
import { clamp, getPointerPosition } from '../utils';
import { ControlPosition } from './types';

type GetResizeDirectionParams = {
  width: number;
  prevWidth: number;
  height: number;
  prevHeight: number;
  affectsX: boolean;
  affectsY: boolean;
};

/**
 * Get all connecting edges for a given set of nodes
 * @param width - new width of the node
 * @param prevWidth - previous width of the node
 * @param height - new height of the node
 * @param prevHeight - previous height of the node
 * @param affectsX - whether to invert the resize direction for the x axis
 * @param affectsY - whether to invert the resize direction for the y axis
 * @returns array of two numbers representing the direction of the resize for each axis, 0 = no change, 1 = increase, -1 = decrease
 */
export function getResizeDirection({
  width,
  prevWidth,
  height,
  prevHeight,
  affectsX,
  affectsY,
}: GetResizeDirectionParams) {
  const deltaWidth = width - prevWidth;
  const deltaHeight = height - prevHeight;

  const direction = [deltaWidth > 0 ? 1 : deltaWidth < 0 ? -1 : 0, deltaHeight > 0 ? 1 : deltaHeight < 0 ? -1 : 0];

  if (deltaWidth && affectsX) {
    direction[0] = direction[0] * -1;
  }

  if (deltaHeight && affectsY) {
    direction[1] = direction[1] * -1;
  }
  return direction;
}

/**
 * Parses the control position that is being dragged to dimensions that are being resized
 * @param controlPosition - position of the control that is being dragged
 * @returns isHorizontal, isVertical, affectsX, affectsY,
 */
export function getControlDirection(controlPosition: ControlPosition) {
  const isHorizontal = controlPosition.includes('right') || controlPosition.includes('left');
  const isVertical = controlPosition.includes('bottom') || controlPosition.includes('top');
  const affectsX = controlPosition.includes('left');
  const affectsY = controlPosition.includes('top');

  return {
    isHorizontal,
    isVertical,
    affectsX,
    affectsY,
  };
}

type PrevValues = {
  width: number;
  height: number;
  x: number;
  y: number;
};

type StartValues = PrevValues & {
  pointerX: number;
  pointerY: number;
  aspectRatio: number;
};

function getLowerExtentClamp(lowerExtent: number, lowerBound: number) {
  return Math.max(0, lowerBound - lowerExtent);
}

function getUpperExtentClamp(upperExtent: number, upperBound: number) {
  return Math.max(0, upperExtent - upperBound);
}

function getSizeClamp(size: number, minSize: number, maxSize: number) {
  return Math.max(0, minSize - size, size - maxSize);
}

/**
 * Calculates new width & height of node after resize based on pointer position
 * @param startValues - starting values of resize
 * @param controlDirection - dimensions affected by the resize
 * @param pointerPosition - the current pointer position corrected for snapping
 * @param boundaries - minimum and maximum dimensions of the node
 * @param keepAspectRatio - prevent changes of asprect ratio
 * @returns width: new width of node, height: new height of node
 */
export function getDimensionsAfterResize(
  startValues: StartValues,
  controlDirection: ReturnType<typeof getControlDirection>,
  pointerPosition: ReturnType<typeof getPointerPosition>,
  boundaries: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number },
  keepAspectRatio: boolean,
  extent?: CoordinateExtent
) {
  let { affectsX, affectsY } = controlDirection;
  const { isHorizontal, isVertical } = controlDirection;
  const isDiagonal = isHorizontal && isVertical;

  const { xSnapped, ySnapped } = pointerPosition;
  const { minWidth, maxWidth, minHeight, maxHeight } = boundaries;

  const { x: startX, y: startY, width: startWidth, height: startHeight, aspectRatio } = startValues;
  let distX = Math.floor(isHorizontal ? xSnapped - startValues.pointerX : 0);
  let distY = Math.floor(isVertical ? ySnapped - startValues.pointerY : 0);

  let newWidth = startWidth + (affectsX ? -distX : distX);
  let newHeight = startHeight + (affectsY ? -distY : distY);

  // Check if maxWidth, minWWidth, maxHeight, minHeight are restricting the resize
  let clampX = getSizeClamp(newWidth, minWidth, maxWidth);
  let clampY = getSizeClamp(newHeight, minHeight, maxHeight);

  // Check if extent is restricting the resize
  if (extent) {
    let xExtentClamp = 0;
    let yExtentClamp = 0;
    if (affectsX && distX < 0) {
      xExtentClamp = getLowerExtentClamp(startX + distX, extent[0][0]);
    } else if (!affectsX && distX > 0) {
      xExtentClamp = getUpperExtentClamp(startX + newWidth, extent[1][0]);
    }

    if (affectsY && distY < 0) {
      yExtentClamp = getLowerExtentClamp(startY + distY, extent[0][1]);
    } else if (!affectsY && distY > 0) {
      yExtentClamp = getUpperExtentClamp(startY + newHeight, extent[1][1]);
    }

    clampX = Math.max(clampX, xExtentClamp);
    clampY = Math.max(clampY, yExtentClamp);
  }

  // Check if the aspect ratio resizing of the other side is restricting the resize
  if (keepAspectRatio) {
    if (isHorizontal) {
      // Check if the max dimensions might be restricting the resize
      const aspectHeightClamp = getSizeClamp(newWidth / aspectRatio, minHeight, maxHeight) * aspectRatio;
      clampX = Math.max(clampX, aspectHeightClamp);

      // Check if the extent is restricting the resize
      if (extent) {
        let aspectExtentClamp = 0;
        if ((!affectsX && !affectsY) || (affectsX && !affectsY && isDiagonal)) {
          aspectExtentClamp = getUpperExtentClamp(startY + newWidth / aspectRatio, extent[1][1]) * aspectRatio;
        } else {
          aspectExtentClamp =
            getLowerExtentClamp(startY + (affectsX ? distX : -distX) / aspectRatio, extent[0][1]) * aspectRatio;
        }
        clampX = Math.max(clampX, aspectExtentClamp);
      }
    }

    if (isVertical) {
      const aspectWidthClamp = getSizeClamp(newHeight * aspectRatio, minWidth, maxWidth) / aspectRatio;
      clampY = Math.max(clampY, aspectWidthClamp);

      if (extent) {
        let aspectExtentClamp = 0;
        if ((!affectsX && !affectsY) || (affectsY && !affectsX && isDiagonal)) {
          aspectExtentClamp = getUpperExtentClamp(startX + newHeight * aspectRatio, extent[1][0]) / aspectRatio;
        } else {
          aspectExtentClamp =
            getLowerExtentClamp(startX + (affectsY ? distY : -distY) * aspectRatio, extent[0][0]) / aspectRatio;
        }
        clampY = Math.max(clampY, aspectExtentClamp);
      }
    }
  }

  distY = distY + (distY < 0 ? clampY : -clampY);
  distX = distX + (distX < 0 ? clampX : -clampX);

  function xor(a: boolean, b: boolean) {
    return a ? !b : b;
  }

  if (keepAspectRatio) {
    if (isDiagonal) {
      if (newWidth > newHeight * aspectRatio) {
        distY = (xor(affectsX, affectsY) ? -distX : distX) / aspectRatio;
      } else {
        distX = (xor(affectsX, affectsY) ? -distY : distY) * aspectRatio;
      }
    } else {
      if (isHorizontal) {
        if (affectsX) {
          distY = distX / aspectRatio;
          affectsY = true;
        } else {
          distY = distX / aspectRatio;
        }
      } else {
        if (affectsY) {
          distX = distY * aspectRatio;
          affectsX = true;
        } else {
          distX = distY * aspectRatio;
        }
      }
    }
  }

  let width = startWidth + (affectsX ? -distX : distX);
  let height = startHeight + (affectsY ? -distY : distY);

  let x = affectsX ? startX + distX : startX;
  let y = affectsY ? startY + distY : startY;

  return {
    width,
    height,
    x,
    y,
  };
}

/**
 * Determines new x & y position of node after resize based on new width & height
 * @param startValues - starting values of resize
 * @param controlDirection - dimensions affected by the resize
 * @param width - new width of node
 * @param height - new height of node
 * @returns x: new x position of node, y: new y position of node
 */
export function getPositionAfterResize(
  startValues: StartValues,
  controlDirection: ReturnType<typeof getControlDirection>,
  width: number,
  height: number,
  extent?: CoordinateExtent
) {
  let x = controlDirection.affectsX ? startValues.x - (width - startValues.width) : startValues.x;
  let y = controlDirection.affectsY ? startValues.y - (height - startValues.height) : startValues.y;
  let clampedX = 0;
  let clampedY = 0;

  if (extent) {
    clampedX = Math.max(Math.max(0, x - extent[1][0]), Math.max(0, extent[0][0] - x));
    clampedY = Math.max(Math.max(0, y - extent[1][1]), Math.max(0, extent[0][1] - y));
    x = x + clampedX;
    y = y + clampedY;
  }

  return { x, y, clampedX, clampedY };
}
