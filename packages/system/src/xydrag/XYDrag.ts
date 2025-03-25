/* eslint-disable @typescript-eslint/no-explicit-any */
import { drag } from 'd3-drag'; // 导入d3-drag的拖拽功能
import { select, type Selection } from 'd3-selection'; // 导入d3-selection的select函数和Selection类型

import {
  calcAutoPan, // 计算自动平移
  getEventPosition, // 获取事件位置
  getPointerPosition, // 获取指针位置
  calculateNodePosition, // 计算节点位置
  snapPosition, // 对齐位置到网格
  getInternalNodesBounds, // 获取内部节点边界
  rectToBox, // 将矩形转换为盒子
} from '../utils';
import { getDragItems, getEventHandlerParams, hasSelector } from './utils'; // 导入拖拽相关的工具函数
import type {
  NodeBase, // 节点基础类型
  NodeDragItem, // 节点拖拽项类型
  UseDragEvent, // 拖拽事件类型
  XYPosition, // XY位置类型
  EdgeBase, // 边基础类型
  CoordinateExtent, // 坐标范围类型
  NodeOrigin, // 节点原点类型
  OnError, // 错误处理回调类型
  SnapGrid, // 网格对齐类型
  Transform, // 变换矩阵类型
  PanBy, // 平移函数类型
  OnSelectionDrag, // 选择拖拽回调类型
  UpdateNodePositions, // 更新节点位置函数类型
  Box, // 盒子类型
  InternalNodeBase, // 内部节点基础类型
} from '../types';

export type OnDrag = (
  // 定义OnDrag回调函数类型
  event: MouseEvent, // 鼠标事件
  dragItems: Map<string, NodeDragItem>, // 拖拽项
  node: NodeBase, // 节点
  nodes: NodeBase[] // 节点数组
) => void;

type StoreItems<OnNodeDrag> = {
  // 定义存储项类型
  nodes: NodeBase[]; // 节点数组
  nodeLookup: Map<string, InternalNodeBase>; // 节点查找映射
  edges: EdgeBase[]; // 边数组
  nodeExtent: CoordinateExtent; // 节点范围限制
  snapGrid: SnapGrid; // 网格对齐设置
  snapToGrid: boolean; // 是否启用网格对齐
  nodeOrigin: NodeOrigin; // 节点原点
  multiSelectionActive: boolean; // 是否激活多选
  domNode?: Element | null; // DOM节点
  transform: Transform; // 变换矩阵
  autoPanOnNodeDrag: boolean; // 拖拽节点时是否自动平移
  nodesDraggable: boolean; // 节点是否可拖拽
  selectNodesOnDrag: boolean; // 拖拽时是否选择节点
  nodeDragThreshold: number; // 节点拖拽阈值
  panBy: PanBy; // 平移函数
  unselectNodesAndEdges: (params?: { nodes?: NodeBase[]; edges?: EdgeBase[] }) => void; // 取消选择节点和边的函数
  onError?: OnError; // 错误处理回调
  onNodeDragStart?: OnNodeDrag; // 节点开始拖拽回调
  onNodeDrag?: OnNodeDrag; // 节点拖拽中回调
  onNodeDragStop?: OnNodeDrag; // 节点停止拖拽回调
  onSelectionDragStart?: OnSelectionDrag; // 选择开始拖拽回调
  onSelectionDrag?: OnSelectionDrag; // 选择拖拽中回调
  onSelectionDragStop?: OnSelectionDrag; // 选择停止拖拽回调
  updateNodePositions: UpdateNodePositions; // 更新节点位置的函数
  autoPanSpeed?: number; // 自动平移速度
};

export type XYDragParams<OnNodeDrag> = {
  // 定义XYDrag参数类型
  getStoreItems: () => StoreItems<OnNodeDrag>; // 获取存储项的函数
  onDragStart?: OnDrag; // 开始拖拽回调
  onDrag?: OnDrag; // 拖拽中回调
  onDragStop?: OnDrag; // 停止拖拽回调
  onNodeMouseDown?: (id: string) => void; // 节点鼠标按下回调
  autoPanSpeed?: number; // 自动平移速度
};

export type XYDragInstance = {
  // 定义XYDrag实例类型
  update: (params: DragUpdateParams) => void; // 更新函数
  destroy: () => void; // 销毁函数
};

export type DragUpdateParams = {
  // 定义拖拽更新参数类型
  noDragClassName?: string; // 不可拖拽的CSS类名
  handleSelector?: string; // 拖拽把手选择器
  isSelectable?: boolean; // 是否可选择
  nodeId?: string; // 节点ID
  domNode: Element; // DOM节点
  nodeClickDistance?: number; // 节点点击距离
};

// XYDrag函数实现
export function XYDrag<OnNodeDrag extends (e: any, nodes: any, node: any) => void | undefined>({
  onNodeMouseDown, // 节点鼠标按下回调
  getStoreItems, // 获取存储项函数
  onDragStart, // 开始拖拽回调
  onDrag, // 拖拽中回调
  onDragStop, // 停止拖拽回调
}: XYDragParams<OnNodeDrag>): XYDragInstance {
  let lastPos: { x: number | null; y: number | null } = { x: null, y: null }; // 最后的位置
  let autoPanId = 0; // 自动平移的ID
  let dragItems = new Map<string, NodeDragItem>(); // 拖拽项
  let autoPanStarted = false; // 自动平移是否已开始
  let mousePosition: XYPosition = { x: 0, y: 0 }; // 鼠标位置
  let containerBounds: DOMRect | null = null; // 容器边界
  let dragStarted = false; // 拖拽是否已开始
  let d3Selection: Selection<Element, unknown, null, undefined> | null = null; // D3选择
  let abortDrag = false; // 中止拖拽，防止多点触控意外拖拽

  // 公共函数
  function update({
    // 更新函数
    noDragClassName, // 不可拖拽的CSS类名
    handleSelector, // 拖拽把手选择器
    domNode, // DOM节点
    isSelectable, // 是否可选择
    nodeId, // 节点ID
    nodeClickDistance = 0, // 节点点击距离
  }: DragUpdateParams) {
    d3Selection = select(domNode); // 选择DOM节点

    function updateNodes({ x, y }: XYPosition, dragEvent: MouseEvent | null) {
      // 更新节点位置函数
      const {
        nodeLookup, // 节点查找映射
        nodeExtent, // 节点范围限制
        snapGrid, // 网格对齐设置
        snapToGrid, // 是否启用网格对齐
        nodeOrigin, // 节点原点
        onNodeDrag, // 节点拖拽中回调
        onSelectionDrag, // 选择拖拽中回调
        onError, // 错误处理回调
        updateNodePositions, // 更新节点位置的函数
      } = getStoreItems();

      lastPos = { x, y }; // 更新最后位置

      let hasChange = false; // 初始化变化标志
      let nodesBox: Box = { x: 0, y: 0, x2: 0, y2: 0 }; // 初始化节点盒子

      if (dragItems.size > 1 && nodeExtent) {
        // 如果有多个拖拽项且设置了节点范围
        const rect = getInternalNodesBounds(dragItems); // 获取内部节点边界
        nodesBox = rectToBox(rect); // 将矩形转换为盒子
      }

      for (const [id, dragItem] of dragItems) {
        // 遍历所有拖拽项
        if (!nodeLookup.has(id)) {
          // 如果节点不再存在
          /*
           * 如果节点不再在nodeLookup中，可能是在拖拽过程中被删除了
           * 我们不需要再更新它
           */
          continue;
        }

        let nextPosition = { x: x - dragItem.distance.x, y: y - dragItem.distance.y }; // 计算下一个位置
        if (snapToGrid) {
          // 如果启用网格对齐
          nextPosition = snapPosition(nextPosition, snapGrid); // 对齐位置到网格
        }

        /*
         * 如果有多个节点被选中且设置了节点范围，需要为每个节点调整节点范围
         * 基于其相对于选区的位置，使节点保持在相对于选区的位置。
         */
        let adjustedNodeExtent: CoordinateExtent = [
          // 初始化调整后的节点范围
          [nodeExtent[0][0], nodeExtent[0][1]],
          [nodeExtent[1][0], nodeExtent[1][1]],
        ];

        if (dragItems.size > 1 && nodeExtent && !dragItem.extent) {
          // 如果有多个拖拽项且设置了节点范围，并且拖拽项没有自己的范围
          const { positionAbsolute } = dragItem.internals; // 获取绝对位置
          const x1 = positionAbsolute.x - nodesBox.x + nodeExtent[0][0]; // 计算调整后的x1
          const x2 = positionAbsolute.x + dragItem.measured.width - nodesBox.x2 + nodeExtent[1][0]; // 计算调整后的x2

          const y1 = positionAbsolute.y - nodesBox.y + nodeExtent[0][1]; // 计算调整后的y1
          const y2 = positionAbsolute.y + dragItem.measured.height - nodesBox.y2 + nodeExtent[1][1]; // 计算调整后的y2

          adjustedNodeExtent = [
            // 设置调整后的节点范围
            [x1, y1],
            [x2, y2],
          ];
        }

        const { position, positionAbsolute } = calculateNodePosition({
          // 计算节点位置
          nodeId: id, // 节点ID
          nextPosition, // 下一个位置
          nodeLookup, // 节点查找映射
          nodeExtent: adjustedNodeExtent, // 调整后的节点范围
          nodeOrigin, // 节点原点
          onError, // 错误处理回调
        });

        // 确保只有在位置发生变化时才触发变更事件
        hasChange = hasChange || dragItem.position.x !== position.x || dragItem.position.y !== position.y;

        dragItem.position = position; // 更新拖拽项的位置
        dragItem.internals.positionAbsolute = positionAbsolute; // 更新拖拽项的绝对位置
      }

      if (!hasChange) {
        // 如果没有变化
        return; // 返回
      }

      updateNodePositions(dragItems, true); // 更新节点位置

      if (dragEvent && (onDrag || onNodeDrag || (!nodeId && onSelectionDrag))) {
        // 如果有拖拽事件且有回调
        const [currentNode, currentNodes] = getEventHandlerParams({
          // 获取事件处理参数
          nodeId,
          dragItems,
          nodeLookup,
        });

        onDrag?.(dragEvent, dragItems, currentNode, currentNodes); // 触发拖拽中回调
        onNodeDrag?.(dragEvent, currentNode, currentNodes); // 触发节点拖拽中回调

        if (!nodeId) {
          // 如果没有指定节点ID
          onSelectionDrag?.(dragEvent, currentNodes); // 触发选择拖拽中回调
        }
      }
    }

    async function autoPan() {
      // 自动平移函数
      if (!containerBounds) {
        // 如果没有容器边界
        return; // 返回
      }

      const { transform, panBy, autoPanSpeed, autoPanOnNodeDrag } = getStoreItems(); // 获取存储项

      if (!autoPanOnNodeDrag) {
        // 如果不需要自动平移
        autoPanStarted = false; // 设置自动平移未开始
        cancelAnimationFrame(autoPanId); // 取消动画帧
        return; // 返回
      }

      const [xMovement, yMovement] = calcAutoPan(mousePosition, containerBounds, autoPanSpeed); // 计算自动平移的移动距离

      if (xMovement !== 0 || yMovement !== 0) {
        // 如果有移动距离
        lastPos.x = (lastPos.x ?? 0) - xMovement / transform[2]; // 更新最后位置的x
        lastPos.y = (lastPos.y ?? 0) - yMovement / transform[2]; // 更新最后位置的y

        if (await panBy({ x: xMovement, y: yMovement })) {
          // 执行平移
          updateNodes(lastPos as XYPosition, null); // 更新节点位置
        }
      }

      autoPanId = requestAnimationFrame(autoPan); // 请求下一帧的自动平移
    }

    function startDrag(event: UseDragEvent) {
      // 开始拖拽函数
      const {
        nodeLookup, // 节点查找映射
        multiSelectionActive, // 是否激活多选
        nodesDraggable, // 节点是否可拖拽
        transform, // 变换矩阵
        snapGrid, // 网格对齐设置
        snapToGrid, // 是否启用网格对齐
        selectNodesOnDrag, // 拖拽时是否选择节点
        onNodeDragStart, // 节点开始拖拽回调
        onSelectionDragStart, // 选择开始拖拽回调
        unselectNodesAndEdges, // 取消选择节点和边的函数
      } = getStoreItems();

      dragStarted = true; // 设置拖拽已开始

      if ((!selectNodesOnDrag || !isSelectable) && !multiSelectionActive && nodeId) {
        // 如果不选择节点或非可选择状态，且非多选且有节点ID
        if (!nodeLookup.get(nodeId)?.selected) {
          // 如果节点未被选中
          unselectNodesAndEdges(); // 取消选择所有节点和边
        }
      }

      if (isSelectable && selectNodesOnDrag && nodeId) {
        // 如果可选择且拖拽时选择节点且有节点ID
        onNodeMouseDown?.(nodeId); // 触发节点鼠标按下回调
      }

      const pointerPos = getPointerPosition(event.sourceEvent, { transform, snapGrid, snapToGrid, containerBounds }); // 获取指针位置
      lastPos = pointerPos; // 更新最后位置
      dragItems = getDragItems(nodeLookup, nodesDraggable, pointerPos, nodeId); // 获取拖拽项

      if (dragItems.size > 0 && (onDragStart || onNodeDragStart || (!nodeId && onSelectionDragStart))) {
        // 如果有拖拽项且有回调
        const [currentNode, currentNodes] = getEventHandlerParams({
          // 获取事件处理参数
          nodeId,
          dragItems,
          nodeLookup,
        });

        onDragStart?.(event.sourceEvent as MouseEvent, dragItems, currentNode, currentNodes); // 触发开始拖拽回调
        onNodeDragStart?.(event.sourceEvent as MouseEvent, currentNode, currentNodes); // 触发节点开始拖拽回调

        if (!nodeId) {
          // 如果没有指定节点ID
          onSelectionDragStart?.(event.sourceEvent as MouseEvent, currentNodes); // 触发选择开始拖拽回调
        }
      }
    }

    const d3DragInstance = drag() // 创建D3拖拽实例
      .clickDistance(nodeClickDistance) // 设置点击距离
      .on('start', (event: UseDragEvent) => {
        // 开始事件处理器
        const { domNode, nodeDragThreshold, transform, snapGrid, snapToGrid } = getStoreItems(); // 获取存储项
        containerBounds = domNode?.getBoundingClientRect() || null; // 获取容器边界

        abortDrag = false; // 重置中止拖拽标志

        if (nodeDragThreshold === 0) {
          // 如果拖拽阈值为0
          startDrag(event); // 立即开始拖拽
        }

        const pointerPos = getPointerPosition(event.sourceEvent, { transform, snapGrid, snapToGrid, containerBounds }); // 获取指针位置
        lastPos = pointerPos; // 更新最后位置
        mousePosition = getEventPosition(event.sourceEvent, containerBounds!); // 获取鼠标位置
      })
      .on('drag', (event: UseDragEvent) => {
        // 拖拽事件处理器
        const { autoPanOnNodeDrag, transform, snapGrid, snapToGrid, nodeDragThreshold, nodeLookup } = getStoreItems(); // 获取存储项
        const pointerPos = getPointerPosition(event.sourceEvent, { transform, snapGrid, snapToGrid, containerBounds }); // 获取指针位置

        if (
          (event.sourceEvent.type === 'touchmove' && event.sourceEvent.touches.length > 1) || // 如果是多点触控
          // 如果用户在拖拽过程中删除了节点，需要中止拖拽以防止错误
          (nodeId && !nodeLookup.has(nodeId)) // 如果节点被删除
        ) {
          abortDrag = true; // 设置中止拖拽标志
        }

        if (abortDrag) {
          // 如果中止拖拽
          return; // 返回
        }

        if (!autoPanStarted && autoPanOnNodeDrag && dragStarted) {
          // 如果需要自动平移且拖拽已开始但自动平移未开始
          autoPanStarted = true; // 设置自动平移已开始
          autoPan(); // 启动自动平移
        }

        if (!dragStarted) {
          // 如果拖拽未开始
          const x = pointerPos.xSnapped - (lastPos.x ?? 0); // 计算x方向移动距离
          const y = pointerPos.ySnapped - (lastPos.y ?? 0); // 计算y方向移动距离
          const distance = Math.sqrt(x * x + y * y); // 计算移动距离

          if (distance > nodeDragThreshold) {
            // 如果超过拖拽阈值
            startDrag(event); // 开始拖拽
          }
        }

        // 跳过没有移动的事件
        if ((lastPos.x !== pointerPos.xSnapped || lastPos.y !== pointerPos.ySnapped) && dragItems && dragStarted) {
          mousePosition = getEventPosition(event.sourceEvent, containerBounds!); // 更新鼠标位置

          updateNodes(pointerPos, event.sourceEvent as MouseEvent); // 更新节点位置
        }
      })
      .on('end', (event: UseDragEvent) => {
        // 结束事件处理器
        if (!dragStarted || abortDrag) {
          // 如果拖拽未开始或已中止
          return; // 返回
        }

        autoPanStarted = false; // 设置自动平移未开始
        dragStarted = false; // 设置拖拽未开始
        cancelAnimationFrame(autoPanId); // 取消动画帧

        if (dragItems.size > 0) {
          // 如果有拖拽项
          const { nodeLookup, updateNodePositions, onNodeDragStop, onSelectionDragStop } = getStoreItems(); // 获取存储项

          updateNodePositions(dragItems, false); // 更新节点位置

          if (onDragStop || onNodeDragStop || (!nodeId && onSelectionDragStop)) {
            // 如果有回调
            const [currentNode, currentNodes] = getEventHandlerParams({
              // 获取事件处理参数
              nodeId,
              dragItems,
              nodeLookup,
              dragging: false, // 设置拖拽状态为false
            });

            onDragStop?.(event.sourceEvent as MouseEvent, dragItems, currentNode, currentNodes); // 触发停止拖拽回调
            onNodeDragStop?.(event.sourceEvent as MouseEvent, currentNode, currentNodes); // 触发节点停止拖拽回调

            if (!nodeId) {
              // 如果没有指定节点ID
              onSelectionDragStop?.(event.sourceEvent as MouseEvent, currentNodes); // 触发选择停止拖拽回调
            }
          }
        }
      })
      .filter((event: MouseEvent) => {
        // 过滤器函数
        const target = event.target; // 获取目标元素
        const isDraggable = // 判断是否可拖拽
          !event.button && // 非右键
          (!noDragClassName || !hasSelector(target, `.${noDragClassName}`, domNode)) && // 不包含不可拖拽类名
          (!handleSelector || hasSelector(target, handleSelector, domNode)); // 匹配拖拽把手选择器

        return isDraggable; // 返回是否可拖拽
      });

    d3Selection.call(d3DragInstance); // 将D3拖拽实例应用到选择元素
  }

  function destroy() {
    // 销毁函数
    d3Selection?.on('.drag', null); // 移除所有拖拽相关的事件监听器
  }

  return {
    // 返回XYDrag实例
    update, // 更新函数
    destroy, // 销毁函数
  };
}
