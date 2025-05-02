/**
 当用户按住 Shift 键拖动鼠标时，会显示用户选择矩形。
 */

import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { shallow } from 'zustand/shallow';
import cc from 'classcat';
import {
  getNodesInside,
  getEventPosition,
  SelectionMode,
  areSetsEqual,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/system';

import { UserSelection } from '../../components/UserSelection';
import { containerStyle } from '../../styles/utils';
import { useStore, useStoreApi } from '../../hooks/useStore';
import { getSelectionChanges } from '../../utils';
import type { ReactFlowProps, ReactFlowState } from '../../types';

type PaneProps = {
  isSelecting: boolean; // 是否处于选择模式
  selectionKeyPressed: boolean; // 选择快捷键是否被按下
  children: ReactNode; // 子元素（节点、边等）
} & Partial<
  Pick<
    ReactFlowProps,
    // 从ReactFlowProps中选择的可选属性
    | 'selectionMode' // 选择模式（完全/部分）
    | 'panOnDrag' // 是否允许拖拽平移
    | 'onSelectionStart' // 选择开始事件回调
    | 'onSelectionEnd' // 选择结束事件回调
    | 'onPaneClick' // 面板点击事件回调
    | 'onPaneContextMenu' // 面板右键菜单事件回调
    | 'onPaneScroll' // 面板滚动事件回调
    | 'onPaneMouseEnter' // 鼠标进入面板事件回调
    | 'onPaneMouseMove' // 鼠标在面板上移动事件回调
    | 'onPaneMouseLeave' // 鼠标离开面板事件回调
    | 'selectionOnDrag' // 是否允许拖拽选择
  >
>;

const wrapHandler = (
  handler: React.MouseEventHandler | undefined,
  containerRef: React.MutableRefObject<HTMLDivElement | null>
): React.MouseEventHandler => {
  return (event: ReactMouseEvent) => {
    if (event.target !== containerRef.current) {
      return;
    }
    handler?.(event);
  };
};

const selector = (s: ReactFlowState) => ({
  userSelectionActive: s.userSelectionActive,
  elementsSelectable: s.elementsSelectable,
  dragging: s.paneDragging,
});

export function Pane({
  isSelecting,
  selectionKeyPressed,
  selectionMode = SelectionMode.Full,
  panOnDrag,
  selectionOnDrag,
  onSelectionStart,
  onSelectionEnd,
  onPaneClick,
  onPaneContextMenu,
  onPaneScroll,
  onPaneMouseEnter,
  onPaneMouseMove,
  onPaneMouseLeave,
  children,
}: PaneProps) {
  const store = useStoreApi(); // 获取状态存储API
  const { userSelectionActive, elementsSelectable, dragging } = useStore(selector, shallow); // 获取相关状态
  const hasActiveSelection = elementsSelectable && (isSelecting || userSelectionActive); // 判断是否有活动选择

  const container = useRef<HTMLDivElement | null>(null); // 容器DOM引用
  const containerBounds = useRef<DOMRect>(); // 容器边界尺寸引用

  const selectedNodeIds = useRef<Set<string>>(new Set()); // 存储已选节点ID
  const selectedEdgeIds = useRef<Set<string>>(new Set()); // 存储已选边ID

  // 用于防止在选择过程中松开选择键后触发点击事件
  const selectionInProgress = useRef<boolean>(false);
  const selectionStarted = useRef<boolean>(false); // 选择是否已开始
  // 点击事件处理函数
  const onClick = (event: ReactMouseEvent) => {
    // 防止在选择过程中松开选择键后触发点击事件
    if (selectionInProgress.current) {
      selectionInProgress.current = false;
      return;
    }

    onPaneClick?.(event); // 调用用户提供的点击回调
    store.getState().resetSelectedElements(); // 重置选中元素
    store.setState({ nodesSelectionActive: false }); // 关闭节点选择激活状态
  };

  // 右键菜单事件处理函数
  const onContextMenu = (event: ReactMouseEvent) => {
    if (Array.isArray(panOnDrag) && panOnDrag?.includes(2)) {
      // 如果配置了右键拖拽平移，阻止默认右键菜单
      event.preventDefault();
      return;
    }

    onPaneContextMenu?.(event); // 调用用户提供的右键菜单回调
  };

  // 处理滚轮事件
  const onWheel = onPaneScroll ? (event: React.WheelEvent) => onPaneScroll(event) : undefined;

  // 指针按下事件处理函数
  const onPointerDown = (event: ReactPointerEvent): void => {
    const { resetSelectedElements, domNode } = store.getState();
    containerBounds.current = domNode?.getBoundingClientRect(); // 获取容器边界

    if (
      !elementsSelectable || // 元素不可选
      !isSelecting || // 不处于选择模式
      event.button !== 0 || // 不是左键
      event.target !== container.current || // 点击目标不是容器
      !containerBounds.current // 容器边界不存在
    ) {
      return;
    }

    // 设置指针捕获，确保即使指针移出容器也能接收事件
    (event.target as Partial<Element> | null)?.setPointerCapture?.(event.pointerId);

    selectionStarted.current = true; // 标记选择已开始
    selectionInProgress.current = false; // 重置选择进行中状态

    // 获取相对于容器的点击位置
    const { x, y } = getEventPosition(event.nativeEvent, containerBounds.current);

    resetSelectedElements(); // 重置已选元素

    // 设置选择矩形初始状态
    store.setState({
      userSelectionRect: {
        width: 0,
        height: 0,
        startX: x,
        startY: y,
        x,
        y,
      },
    });

    onSelectionStart?.(event); // 调用选择开始回调
  };

  // 指针移动事件处理函数
  const onPointerMove = (event: ReactPointerEvent): void => {
    const {
      userSelectionRect,
      transform,
      nodeLookup,
      edgeLookup,
      connectionLookup,
      triggerNodeChanges,
      triggerEdgeChanges,
      defaultEdgeOptions,
    } = store.getState();

    if (!containerBounds.current || !userSelectionRect) {
      return;
    }

    selectionInProgress.current = true; // 标记选择进行中

    // 获取鼠标当前位置
    const { x: mouseX, y: mouseY } = getEventPosition(event.nativeEvent, containerBounds.current);
    const { startX, startY } = userSelectionRect;

    // 计算新的选择矩形（处理从任意方向拖拽的情况）
    const nextUserSelectRect = {
      startX,
      startY,
      x: mouseX < startX ? mouseX : startX, // 左边为较小的x
      y: mouseY < startY ? mouseY : startY, // 顶边为较小的y
      width: Math.abs(mouseX - startX), // 宽度为x差的绝对值
      height: Math.abs(mouseY - startY), // 高度为y差的绝对值
    };

    const prevSelectedNodeIds = selectedNodeIds.current; // 保存之前选中的节点ID
    const prevSelectedEdgeIds = selectedEdgeIds.current; // 保存之前选中的边ID

    // 计算在选择矩形内的节点
    selectedNodeIds.current = new Set(
      getNodesInside(nodeLookup, nextUserSelectRect, transform, selectionMode === SelectionMode.Partial, true).map(
        (node) => node.id
      )
    );

    selectedEdgeIds.current = new Set();
    const edgesSelectable = defaultEdgeOptions?.selectable ?? true; // 默认边可选

    // 查找所有与选中节点相连的边
    for (const nodeId of selectedNodeIds.current) {
      const connections = connectionLookup.get(nodeId);
      if (!connections) continue;
      for (const { edgeId } of connections.values()) {
        const edge = edgeLookup.get(edgeId);
        if (edge && (edge.selectable ?? edgesSelectable)) {
          selectedEdgeIds.current.add(edgeId); // 添加可选的边到选中集合
        }
      }
    }

    // 如果节点选择发生变化，触发节点变更
    if (!areSetsEqual(prevSelectedNodeIds, selectedNodeIds.current)) {
      const changes = getSelectionChanges(nodeLookup, selectedNodeIds.current, true) as NodeChange[];
      triggerNodeChanges(changes);
    }

    // 如果边选择发生变化，触发边变更
    if (!areSetsEqual(prevSelectedEdgeIds, selectedEdgeIds.current)) {
      const changes = getSelectionChanges(edgeLookup, selectedEdgeIds.current) as EdgeChange[];
      triggerEdgeChanges(changes);
    }

    // 更新状态
    store.setState({
      userSelectionRect: nextUserSelectRect, // 更新选择矩形
      userSelectionActive: true, // 激活用户选择
      nodesSelectionActive: false, // 关闭节点选择激活
    });
  };

  // 指针抬起事件处理函数
  const onPointerUp = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !selectionStarted.current) {
      return;
    }

    // 释放指针捕获
    (event.target as Partial<Element>)?.releasePointerCapture?.(event.pointerId);
    const { userSelectionRect } = store.getState();

    /*
     * 只有当用户没有移动鼠标且在选择模式下才触发点击函数
     */
    if (!userSelectionActive && userSelectionRect && event.target === container.current) {
      onClick?.(event);
    }

    // 更新状态
    store.setState({
      userSelectionActive: false, // 关闭用户选择激活
      userSelectionRect: null, // 清除选择矩形
      nodesSelectionActive: selectedNodeIds.current.size > 0, // 根据选中节点数量设置节点选择激活
    });
    onSelectionEnd?.(event); // 调用选择结束回调

    /*
     * 如果用户在选择过程中一直按住选择键，
     * 需要重置selectionInProgress，以免阻止下一个点击事件
     */
    if (selectionKeyPressed || selectionOnDrag) {
      selectionInProgress.current = false;
    }

    selectionStarted.current = false; // 标记选择已结束
  };

  const draggable = panOnDrag === true || (Array.isArray(panOnDrag) && panOnDrag.includes(0));

  return (
    <div
      className={cc(['react-flow__pane', { draggable, dragging, selection: isSelecting }])}
      onClick={hasActiveSelection ? undefined : wrapHandler(onClick, container)}
      onContextMenu={wrapHandler(onContextMenu, container)}
      onWheel={wrapHandler(onWheel, container)}
      onPointerEnter={hasActiveSelection ? undefined : onPaneMouseEnter}
      onPointerDown={hasActiveSelection ? onPointerDown : onPaneMouseMove}
      onPointerMove={hasActiveSelection ? onPointerMove : onPaneMouseMove}
      onPointerUp={hasActiveSelection ? onPointerUp : undefined}
      onPointerLeave={onPaneMouseLeave}
      ref={container}
      style={containerStyle}
    >
      {children}
      <UserSelection />
    </div>
  );
}
