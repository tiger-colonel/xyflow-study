import { CoordinateExtent, NodeOrigin } from '../types'; // 导入坐标范围和节点原点类型
import { getPointerPosition } from '../utils'; // 导入获取指针位置的工具函数
import { ControlPosition } from './types'; // 导入控制位置类型

type GetResizeDirectionParams = {
  // 获取调整大小方向的参数类型
  width: number; // 宽度
  prevWidth: number; // 前一个宽度
  height: number; // 高度
  prevHeight: number; // 前一个高度
  affectsX: boolean; // 是否影响X轴
  affectsY: boolean; // 是否影响Y轴
};

/**
 * 获取给定节点集的所有连接边
 * @param width - 节点的新宽度
 * @param prevWidth - 节点的前一个宽度
 * @param height - 节点的新高度
 * @param prevHeight - 节点的前一个高度
 * @param affectsX - 是否对X轴的调整方向进行反转
 * @param affectsY - 是否对Y轴的调整方向进行反转
 * @returns 表示每个轴的调整方向的两个数字的数组，0=无变化，1=增加，-1=减少
 */
export function getResizeDirection({
  width,
  prevWidth,
  height,
  prevHeight,
  affectsX,
  affectsY,
}: GetResizeDirectionParams) {
  const deltaWidth = width - prevWidth; // 计算宽度变化量
  const deltaHeight = height - prevHeight; // 计算高度变化量

  const direction = [deltaWidth > 0 ? 1 : deltaWidth < 0 ? -1 : 0, deltaHeight > 0 ? 1 : deltaHeight < 0 ? -1 : 0]; // 计算方向数组

  if (deltaWidth && affectsX) {
    // 如果宽度有变化且影响X轴
    direction[0] = direction[0] * -1; // 反转X轴方向
  }

  if (deltaHeight && affectsY) {
    // 如果高度有变化且影响Y轴
    direction[1] = direction[1] * -1; // 反转Y轴方向
  }
  return direction; // 返回方向数组
}

/**
 * 解析被拖动的控制位置到正在调整大小的尺寸
 * @param controlPosition - 被拖动的控制的位置
 * @returns isHorizontal, isVertical, affectsX, affectsY
 */
export function getControlDirection(controlPosition: ControlPosition) {
  const isHorizontal = controlPosition.includes('right') || controlPosition.includes('left'); // 是否是水平方向
  const isVertical = controlPosition.includes('bottom') || controlPosition.includes('top'); // 是否是垂直方向
  const affectsX = controlPosition.includes('left'); // 是否影响X轴
  const affectsY = controlPosition.includes('top'); // 是否影响Y轴

  return {
    isHorizontal, // 水平方向
    isVertical, // 垂直方向
    affectsX, // 影响X轴
    affectsY, // 影响Y轴
  };
}

type PrevValues = {
  // 前一个值类型
  width: number; // 宽度
  height: number; // 高度
  x: number; // x坐标
  y: number; // y坐标
};

type StartValues = PrevValues & {
  // 开始值类型，继承前一个值类型
  pointerX: number; // 指针X坐标
  pointerY: number; // 指针Y坐标
  aspectRatio: number; // 宽高比
};

function getLowerExtentClamp(lowerExtent: number, lowerBound: number) {
  // 获取下限约束
  return Math.max(0, lowerBound - lowerExtent); // 返回0和下限与下界之差中的较大值
}

function getUpperExtentClamp(upperExtent: number, upperBound: number) {
  // 获取上限约束
  return Math.max(0, upperExtent - upperBound); // 返回0和上限与上界之差中的较大值
}

function getSizeClamp(size: number, minSize: number, maxSize: number) {
  // 获取大小约束
  return Math.max(0, minSize - size, size - maxSize); // 返回0、最小大小与大小之差、大小与最大大小之差中的最大值
}

function xor(a: boolean, b: boolean) {
  // 异或函数
  return a ? !b : b; // 如果a为真，返回b的否定；否则返回b
}

/**
 * 基于指针位置计算节点调整大小后的新宽度、高度和x、y坐标
 * @description - 系好安全带，这是个很复杂的函数... 如果你想确定节点调整大小后的新尺寸，
 * 你必须考虑所有可能的限制：节点的最小/最大宽度/高度，节点被允许移动（在这种情况下：调整大小）的最大范围，
 * 由父节点确定的，由设置了expandParent或extent: 'parent'的子节点确定的最小范围，哦，这些还必须与keepAspectRatio一起工作！
 * 实现方式是通过确定每个限制实际限制调整大小的程度，然后应用最强的限制。因为调整大小会影响x、y和宽度、高度，以及保持宽高比时对侧的宽度、高度，
 * 所以调整大小量始终保持在distX和distY量中（鼠标移动的距离）
 * 我们不是对每个值进行约束，而是首先计算最大的"约束"（因为没有更好的名称），然后将其应用于所有值。
 * 复杂的是，nodeOrigin也必须考虑在内。这是通过偏移节点，就好像它们的原点是[0, 0]，然后照常计算限制来完成的
 * @param startValues - 调整大小的起始值
 * @param controlDirection - 受调整大小影响的维度
 * @param pointerPosition - 经过对齐校正的当前指针位置
 * @param boundaries - 节点的最小和最大尺寸
 * @param keepAspectRatio - 防止宽高比变化
 * @returns 调整大小后节点的x、y、宽度和高度
 */
export function getDimensionsAfterResize(
  startValues: StartValues, // 起始值
  controlDirection: ReturnType<typeof getControlDirection>, // 控制方向
  pointerPosition: ReturnType<typeof getPointerPosition>, // 指针位置
  boundaries: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number }, // 边界
  keepAspectRatio: boolean, // 是否保持宽高比
  nodeOrigin: NodeOrigin, // 节点原点
  extent?: CoordinateExtent, // 可选的范围
  childExtent?: CoordinateExtent // 可选的子节点范围
) {
  let { affectsX, affectsY } = controlDirection; // 解构控制方向
  const { isHorizontal, isVertical } = controlDirection; // 解构控制方向
  const isDiagonal = isHorizontal && isVertical; // 是否是对角线方向

  const { xSnapped, ySnapped } = pointerPosition; // 解构指针位置
  const { minWidth, maxWidth, minHeight, maxHeight } = boundaries; // 解构边界

  const { x: startX, y: startY, width: startWidth, height: startHeight, aspectRatio } = startValues; // 解构起始值
  let distX = Math.floor(isHorizontal ? xSnapped - startValues.pointerX : 0); // 计算X方向移动距离
  let distY = Math.floor(isVertical ? ySnapped - startValues.pointerY : 0); // 计算Y方向移动距离

  const newWidth = startWidth + (affectsX ? -distX : distX); // 计算新宽度
  const newHeight = startHeight + (affectsY ? -distY : distY); // 计算新高度

  const originOffsetX = -nodeOrigin[0] * startWidth; // 计算原点X偏移
  const originOffsetY = -nodeOrigin[1] * startHeight; // 计算原点Y偏移

  // 检查maxWidth、minWidth、maxHeight、minHeight是否限制调整大小
  let clampX = getSizeClamp(newWidth, minWidth, maxWidth); // 获取X方向约束
  let clampY = getSizeClamp(newHeight, minHeight, maxHeight); // 获取Y方向约束

  // 检查范围是否限制调整大小
  if (extent) {
    // 如果存在范围
    let xExtentClamp = 0; // 初始化X范围约束
    let yExtentClamp = 0; // 初始化Y范围约束
    if (affectsX && distX < 0) {
      // 如果影响X轴且X方向移动距离小于0
      xExtentClamp = getLowerExtentClamp(startX + distX + originOffsetX, extent[0][0]); // 获取X下限约束
    } else if (!affectsX && distX > 0) {
      // 如果不影响X轴且X方向移动距离大于0
      xExtentClamp = getUpperExtentClamp(startX + newWidth + originOffsetX, extent[1][0]); // 获取X上限约束
    }

    if (affectsY && distY < 0) {
      // 如果影响Y轴且Y方向移动距离小于0
      yExtentClamp = getLowerExtentClamp(startY + distY + originOffsetY, extent[0][1]); // 获取Y下限约束
    } else if (!affectsY && distY > 0) {
      // 如果不影响Y轴且Y方向移动距离大于0
      yExtentClamp = getUpperExtentClamp(startY + newHeight + originOffsetY, extent[1][1]); // 获取Y上限约束
    }

    clampX = Math.max(clampX, xExtentClamp); // 更新X方向约束
    clampY = Math.max(clampY, yExtentClamp); // 更新Y方向约束
  }

  // 检查子节点范围是否限制调整大小
  if (childExtent) {
    // 如果存在子节点范围
    let xExtentClamp = 0; // 初始化X范围约束
    let yExtentClamp = 0; // 初始化Y范围约束
    if (affectsX && distX > 0) {
      // 如果影响X轴且X方向移动距离大于0
      xExtentClamp = getUpperExtentClamp(startX + distX, childExtent[0][0]); // 获取X上限约束
    } else if (!affectsX && distX < 0) {
      // 如果不影响X轴且X方向移动距离小于0
      xExtentClamp = getLowerExtentClamp(startX + newWidth, childExtent[1][0]); // 获取X下限约束
    }

    if (affectsY && distY > 0) {
      // 如果影响Y轴且Y方向移动距离大于0
      yExtentClamp = getUpperExtentClamp(startY + distY, childExtent[0][1]); // 获取Y上限约束
    } else if (!affectsY && distY < 0) {
      // 如果不影响Y轴且Y方向移动距离小于0
      yExtentClamp = getLowerExtentClamp(startY + newHeight, childExtent[1][1]); // 获取Y下限约束
    }

    clampX = Math.max(clampX, xExtentClamp); // 更新X方向约束
    clampY = Math.max(clampY, yExtentClamp); // 更新Y方向约束
  }

  // 检查另一侧的宽高比调整是否限制调整大小
  if (keepAspectRatio) {
    // 如果保持宽高比
    if (isHorizontal) {
      // 如果是水平方向
      // 检查最大尺寸是否可能限制调整大小
      const aspectHeightClamp = getSizeClamp(newWidth / aspectRatio, minHeight, maxHeight) * aspectRatio; // 获取基于宽高比的高度约束
      clampX = Math.max(clampX, aspectHeightClamp); // 更新X方向约束

      // 检查范围是否限制调整大小
      if (extent) {
        // 如果存在范围
        let aspectExtentClamp = 0; // 初始化宽高比范围约束
        if ((!affectsX && !affectsY) || (affectsX && !affectsY && isDiagonal)) {
          // 如果不影响X轴且不影响Y轴或影响X轴且不影响Y轴且是对角线方向
          aspectExtentClamp =
            getUpperExtentClamp(startY + originOffsetY + newWidth / aspectRatio, extent[1][1]) * aspectRatio; // 获取上限约束
        } else {
          // 否则
          aspectExtentClamp =
            getLowerExtentClamp(startY + originOffsetY + (affectsX ? distX : -distX) / aspectRatio, extent[0][1]) *
            aspectRatio; // 获取下限约束
        }
        clampX = Math.max(clampX, aspectExtentClamp); // 更新X方向约束
      }

      // 检查子节点范围是否限制调整大小
      if (childExtent) {
        // 如果存在子节点范围
        let aspectExtentClamp = 0; // 初始化宽高比范围约束
        if ((!affectsX && !affectsY) || (affectsX && !affectsY && isDiagonal)) {
          // 如果不影响X轴且不影响Y轴或影响X轴且不影响Y轴且是对角线方向
          aspectExtentClamp = getLowerExtentClamp(startY + newWidth / aspectRatio, childExtent[1][1]) * aspectRatio; // 获取下限约束
        } else {
          // 否则
          aspectExtentClamp =
            getUpperExtentClamp(startY + (affectsX ? distX : -distX) / aspectRatio, childExtent[0][1]) * aspectRatio; // 获取上限约束
        }
        clampX = Math.max(clampX, aspectExtentClamp); // 更新X方向约束
      }
    }

    // 对垂直调整进行相同操作
    if (isVertical) {
      // 如果是垂直方向
      const aspectWidthClamp = getSizeClamp(newHeight * aspectRatio, minWidth, maxWidth) / aspectRatio; // 获取基于宽高比的宽度约束
      clampY = Math.max(clampY, aspectWidthClamp); // 更新Y方向约束

      if (extent) {
        // 如果存在范围
        let aspectExtentClamp = 0; // 初始化宽高比范围约束
        if ((!affectsX && !affectsY) || (affectsY && !affectsX && isDiagonal)) {
          // 如果不影响X轴且不影响Y轴或影响Y轴且不影响X轴且是对角线方向
          aspectExtentClamp =
            getUpperExtentClamp(startX + newHeight * aspectRatio + originOffsetX, extent[1][0]) / aspectRatio; // 获取上限约束
        } else {
          // 否则
          aspectExtentClamp =
            getLowerExtentClamp(startX + (affectsY ? distY : -distY) * aspectRatio + originOffsetX, extent[0][0]) /
            aspectRatio; // 获取下限约束
        }
        clampY = Math.max(clampY, aspectExtentClamp); // 更新Y方向约束
      }

      if (childExtent) {
        // 如果存在子节点范围
        let aspectExtentClamp = 0; // 初始化宽高比范围约束
        if ((!affectsX && !affectsY) || (affectsY && !affectsX && isDiagonal)) {
          // 如果不影响X轴且不影响Y轴或影响Y轴且不影响X轴且是对角线方向
          aspectExtentClamp = getLowerExtentClamp(startX + newHeight * aspectRatio, childExtent[1][0]) / aspectRatio; // 获取下限约束
        } else {
          // 否则
          aspectExtentClamp =
            getUpperExtentClamp(startX + (affectsY ? distY : -distY) * aspectRatio, childExtent[0][0]) / aspectRatio; // 获取上限约束
        }
        clampY = Math.max(clampY, aspectExtentClamp); // 更新Y方向约束
      }
    }
  }

  distY = distY + (distY < 0 ? clampY : -clampY); // 应用Y方向约束
  distX = distX + (distX < 0 ? clampX : -clampX); // 应用X方向约束

  if (keepAspectRatio) {
    // 如果保持宽高比
    if (isDiagonal) {
      // 如果是对角线方向
      if (newWidth > newHeight * aspectRatio) {
        // 如果新宽度大于新高度乘以宽高比
        distY = (xor(affectsX, affectsY) ? -distX : distX) / aspectRatio; // 计算Y方向移动距离
      } else {
        // 否则
        distX = (xor(affectsX, affectsY) ? -distY : distY) * aspectRatio; // 计算X方向移动距离
      }
    } else {
      // 否则
      if (isHorizontal) {
        // 如果是水平方向
        distY = distX / aspectRatio; // 计算Y方向移动距离
        affectsY = affectsX; // 设置影响Y轴
      } else {
        // 否则
        distX = distY * aspectRatio; // 计算X方向移动距离
        affectsX = affectsY; // 设置影响X轴
      }
    }
  }

  const x = affectsX ? startX + distX : startX; // 计算X坐标
  const y = affectsY ? startY + distY : startY; // 计算Y坐标

  return {
    width: startWidth + (affectsX ? -distX : distX), // 返回宽度
    height: startHeight + (affectsY ? -distY : distY), // 返回高度
    x: nodeOrigin[0] * distX * (!affectsX ? 1 : -1) + x, // 返回X坐标，考虑原点偏移
    y: nodeOrigin[1] * distY * (!affectsY ? 1 : -1) + y, // 返回Y坐标，考虑原点偏移
  };
}
