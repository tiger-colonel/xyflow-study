import { createWithEqualityFn } from 'zustand/traditional';
import {
  getFitViewNodes,
  fitView as fitViewSystem,
  adoptUserNodes,
  updateAbsolutePositions,
  panBy as panBySystem,
  updateNodeInternals as updateNodeInternalsSystem,
  updateConnectionLookup,
  handleExpandParent,
  NodeChange,
  EdgeSelectionChange,
  NodeSelectionChange,
  ParentExpandChild,
  initialConnection,
  NodeOrigin,
  CoordinateExtent,
} from '@xyflow/system';

import { applyEdgeChanges, applyNodeChanges, createSelectionChange, getSelectionChanges } from '../utils/changes';
import getInitialState from './initialState';
import type { ReactFlowState, Node, Edge, UnselectNodesAndEdgesParams, FitViewOptions } from '../types';

const createStore = ({
  nodes,
  edges,
  defaultNodes,
  defaultEdges,
  width,
  height,
  fitView,
  nodeOrigin,
  nodeExtent,
}: {
  nodes?: Node[];
  edges?: Edge[];
  defaultNodes?: Node[];
  defaultEdges?: Edge[];
  width?: number;
  height?: number;
  fitView?: boolean;
  nodeOrigin?: NodeOrigin;
  nodeExtent?: CoordinateExtent;
}) =>
  createWithEqualityFn<ReactFlowState>(
    (set, get) => ({
      ...getInitialState({ nodes, edges, width, height, fitView, nodeOrigin, nodeExtent, defaultNodes, defaultEdges }),
      setNodes: (nodes: Node[]) => {
        const { nodeLookup, parentLookup, nodeOrigin, elevateNodesOnSelect } = get();
        /*
         * setNodes() 仅在响应用户操作时被调用：
         * - 要么是在受控 ReactFlow 设置中更新 `<ReactFlow nodes>` 属性时
         * - 要么是在非受控 ReactFlow 设置中用户调用类似 `reactFlowInstance.setNodes()` 的方法时
         *
         * 当这种情况发生时，我们会采用用户传递的节点对象，并用与 React Flow 内部操作相关的字段扩展它们。
         */
        adoptUserNodes(nodes, nodeLookup, parentLookup, {
          nodeOrigin,
          nodeExtent,
          elevateNodesOnSelect,
          checkEquality: true,
        });

        set({ nodes });
      },
      setEdges: (edges: Edge[]) => {
        const { connectionLookup, edgeLookup } = get();

        updateConnectionLookup(connectionLookup, edgeLookup, edges);

        set({ edges });
      },
      setDefaultNodesAndEdges: (nodes?: Node[], edges?: Edge[]) => {
        if (nodes) {
          const { setNodes } = get();
          setNodes(nodes);
          set({ hasDefaultNodes: true });
        }
        if (edges) {
          const { setEdges } = get();
          setEdges(edges);
          set({ hasDefaultEdges: true });
        }
      },
      /*
       * 每个节点都会在 ResizeObserver 中注册。当节点改变其尺寸时，
       * 此函数会被调用以测量新尺寸并更新节点。
       */
      updateNodeInternals: (updates, params = { triggerFitView: true }) => {
        const {
          triggerNodeChanges,
          nodeLookup,
          parentLookup,
          fitViewOnInit,
          fitViewDone,
          fitViewOnInitOptions,
          domNode,
          nodeOrigin,
          nodeExtent,
          debug,
          fitViewSync,
        } = get();

        const { changes, updatedInternals } = updateNodeInternalsSystem(
          updates,
          nodeLookup,
          parentLookup,
          domNode,
          nodeOrigin,
          nodeExtent
        );

        if (!updatedInternals) {
          return;
        }

        updateAbsolutePositions(nodeLookup, parentLookup, { nodeOrigin, nodeExtent });

        if (params.triggerFitView) {
          // 我们在所有尺寸设置完成后初始化时调用一次 fitView
          let nextFitViewDone = fitViewDone;

          if (!fitViewDone && fitViewOnInit) {
            nextFitViewDone = fitViewSync({
              ...fitViewOnInitOptions,
              nodes: fitViewOnInitOptions?.nodes,
            });
          }

          /*
           * 这里我们绕过了 onNodesChange 处理程序，
           * 以便能够显示节点，即使用户没有提供 onNodesChange 处理程序。
           * 节点只有在具有宽度和高度属性时才会被渲染，而这些属性正是从此处理程序中获取的。
           */
          set({ fitViewDone: nextFitViewDone });
        } else {
          // 我们希望在调用 updateNodeInternals 时始终触发 useStore 调用
          set({});
        }

        if (changes?.length > 0) {
          if (debug) {
            console.log('React Flow: trigger node changes', changes);
          }
          triggerNodeChanges?.(changes);
        }
      },
      updateNodePositions: (nodeDragItems, dragging = false) => {
        const parentExpandChildren: ParentExpandChild[] = [];
        const changes = [];
        const { nodeLookup, triggerNodeChanges } = get();

        for (const [id, dragItem] of nodeDragItems) {
          // 我们使用 nodeLookup 来确保使用当前的 expandParent 和 parentId 值
          const node = nodeLookup.get(id);
          const expandParent = !!(node?.expandParent && node?.parentId && dragItem?.position);

          const change: NodeChange = {
            id,
            type: 'position',
            position: expandParent
              ? {
                  x: Math.max(0, dragItem.position.x),
                  y: Math.max(0, dragItem.position.y),
                }
              : dragItem.position,
            dragging,
          };

          if (expandParent && node.parentId) {
            parentExpandChildren.push({
              id,
              parentId: node.parentId,
              rect: {
                ...dragItem.internals.positionAbsolute,
                width: dragItem.measured.width ?? 0,
                height: dragItem.measured.height ?? 0,
              },
            });
          }

          changes.push(change);
        }

        if (parentExpandChildren.length > 0) {
          const { parentLookup, nodeOrigin } = get();
          const parentExpandChanges = handleExpandParent(parentExpandChildren, nodeLookup, parentLookup, nodeOrigin);
          changes.push(...parentExpandChanges);
        }

        triggerNodeChanges(changes);
      },
      triggerNodeChanges: (changes) => {
        const { onNodesChange, setNodes, nodes, hasDefaultNodes, debug } = get();

        if (changes?.length) {
          if (hasDefaultNodes) {
            const updatedNodes = applyNodeChanges(changes, nodes);
            setNodes(updatedNodes);
          }

          if (debug) {
            console.log('React Flow: trigger node changes', changes);
          }

          onNodesChange?.(changes);
        }
      },
      triggerEdgeChanges: (changes) => {
        const { onEdgesChange, setEdges, edges, hasDefaultEdges, debug } = get();

        if (changes?.length) {
          if (hasDefaultEdges) {
            const updatedEdges = applyEdgeChanges(changes, edges);
            setEdges(updatedEdges);
          }

          if (debug) {
            console.log('React Flow: trigger edge changes', changes);
          }

          onEdgesChange?.(changes);
        }
      },
      addSelectedNodes: (selectedNodeIds) => {
        const { multiSelectionActive, edgeLookup, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get();

        if (multiSelectionActive) {
          const nodeChanges = selectedNodeIds.map((nodeId) => createSelectionChange(nodeId, true));
          triggerNodeChanges(nodeChanges);
          return;
        }

        triggerNodeChanges(getSelectionChanges(nodeLookup, new Set([...selectedNodeIds]), true));
        triggerEdgeChanges(getSelectionChanges(edgeLookup));
      },
      addSelectedEdges: (selectedEdgeIds) => {
        const { multiSelectionActive, edgeLookup, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get();

        if (multiSelectionActive) {
          const changedEdges = selectedEdgeIds.map((edgeId) => createSelectionChange(edgeId, true));
          triggerEdgeChanges(changedEdges);
          return;
        }

        triggerEdgeChanges(getSelectionChanges(edgeLookup, new Set([...selectedEdgeIds])));
        triggerNodeChanges(getSelectionChanges(nodeLookup, new Set(), true));
      },
      unselectNodesAndEdges: ({ nodes, edges }: UnselectNodesAndEdgesParams = {}) => {
        const { edges: storeEdges, nodes: storeNodes, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get();
        const nodesToUnselect = nodes ? nodes : storeNodes;
        const edgesToUnselect = edges ? edges : storeEdges;
        const nodeChanges = nodesToUnselect.map((n) => {
          const internalNode = nodeLookup.get(n.id);
          if (internalNode) {
            /*
             * 在向用户发送更改之前，我们需要取消选择之前已选择的内部节点，
             * 以防止在拖动新节点时它仍然被选中
             */
            internalNode.selected = false;
          }

          return createSelectionChange(n.id, false);
        });
        const edgeChanges = edgesToUnselect.map((edge) => createSelectionChange(edge.id, false));

        triggerNodeChanges(nodeChanges);
        triggerEdgeChanges(edgeChanges);
      },
      setMinZoom: (minZoom) => {
        const { panZoom, maxZoom } = get();
        panZoom?.setScaleExtent([minZoom, maxZoom]);

        set({ minZoom });
      },
      setMaxZoom: (maxZoom) => {
        const { panZoom, minZoom } = get();
        panZoom?.setScaleExtent([minZoom, maxZoom]);

        set({ maxZoom });
      },
      setTranslateExtent: (translateExtent) => {
        get().panZoom?.setTranslateExtent(translateExtent);

        set({ translateExtent });
      },
      setPaneClickDistance: (clickDistance) => {
        get().panZoom?.setClickDistance(clickDistance);
      },
      resetSelectedElements: () => {
        const { edges, nodes, triggerNodeChanges, triggerEdgeChanges } = get();

        const nodeChanges = nodes.reduce<NodeSelectionChange[]>(
          (res, node) => (node.selected ? [...res, createSelectionChange(node.id, false)] : res),
          []
        );
        const edgeChanges = edges.reduce<EdgeSelectionChange[]>(
          (res, edge) => (edge.selected ? [...res, createSelectionChange(edge.id, false)] : res),
          []
        );

        triggerNodeChanges(nodeChanges);
        triggerEdgeChanges(edgeChanges);
      },
      setNodeExtent: (nextNodeExtent) => {
        const { nodes, nodeLookup, parentLookup, nodeOrigin, elevateNodesOnSelect, nodeExtent } = get();

        if (
          nextNodeExtent[0][0] === nodeExtent[0][0] &&
          nextNodeExtent[0][1] === nodeExtent[0][1] &&
          nextNodeExtent[1][0] === nodeExtent[1][0] &&
          nextNodeExtent[1][1] === nodeExtent[1][1]
        ) {
          return;
        }

        adoptUserNodes(nodes, nodeLookup, parentLookup, {
          nodeOrigin,
          nodeExtent: nextNodeExtent,
          elevateNodesOnSelect,
          checkEquality: false,
        });

        set({ nodeExtent: nextNodeExtent });
      },
      panBy: (delta): Promise<boolean> => {
        const { transform, width, height, panZoom, translateExtent } = get();

        return panBySystem({ delta, panZoom, transform, translateExtent, width, height });
      },
      fitView: (options?: FitViewOptions): Promise<boolean> => {
        const { panZoom, width, height, minZoom, maxZoom, nodeLookup } = get();

        if (!panZoom) {
          return Promise.resolve(false);
        }

        const fitViewNodes = getFitViewNodes(nodeLookup, options);

        return fitViewSystem(
          {
            nodes: fitViewNodes,
            width,
            height,
            panZoom,
            minZoom,
            maxZoom,
          },
          options
        );
      },
      /*
       * 我们不能在 updateNodeInternals 中调用异步函数，
       * 因此我们创建了这个 fitView 的同步版本
       */
      fitViewSync: (options?: FitViewOptions): boolean => {
        const { panZoom, width, height, minZoom, maxZoom, nodeLookup } = get();

        if (!panZoom) {
          return false;
        }

        const fitViewNodes = getFitViewNodes(nodeLookup, options);

        fitViewSystem(
          {
            nodes: fitViewNodes,
            width,
            height,
            panZoom,
            minZoom,
            maxZoom,
          },
          options
        );

        return fitViewNodes.size > 0;
      },
      cancelConnection: () => {
        set({
          connection: { ...initialConnection },
        });
      },
      updateConnection: (connection) => {
        set({ connection });
      },

      reset: () => set({ ...getInitialState() }),
    }),
    Object.is
  );

export { createStore };
