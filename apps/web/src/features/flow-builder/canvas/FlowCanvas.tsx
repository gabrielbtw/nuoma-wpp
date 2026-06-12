import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, type DragEvent } from "react";

import "@xyflow/react/dist/style.css";

import type { LibraryBlockKey } from "../config/action-registry.js";
import { type BuilderNode } from "./graph.js";
import { FlowNodeCard } from "./FlowNodeCard.js";
import { insertIndexForY } from "./layout.js";
import { CanvasInteractionsContext, SequenceEdge } from "./SequenceEdge.js";

export const BLOCK_DRAG_MIME = "application/x-nuoma-block";

const nodeTypes: NodeTypes = { builder: FlowNodeCard };
const edgeTypes: EdgeTypes = { sequence: SequenceEdge };

export interface FlowCanvasProps {
  nodes: BuilderNode[];
  edges: Edge[];
  selectedId: string | null;
  /** bump to re-fit the viewport (hydrate, insert, reorder) */
  layoutVersion: number;
  onSelectBlock: (id: string | null) => void;
  onReorder: (orderedIds: string[]) => void;
  onConnectBranch: (sourceId: string, targetId: string) => void;
  onInsertAt: (index: number) => void;
  onDropBlock: (block: LibraryBlockKey, index: number) => void;
}

function FlowCanvasInner({
  nodes: layoutNodes,
  edges,
  selectedId,
  layoutVersion,
  onSelectBlock,
  onReorder,
  onConnectBranch,
  onInsertAt,
  onDropBlock,
}: FlowCanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const layoutRef = useRef(layoutNodes);
  layoutRef.current = layoutNodes;

  useEffect(() => {
    setNodes(
      layoutNodes.map((item) => ({
        ...item,
        selected: item.data.refId !== null && item.data.refId === selectedId,
      })),
    );
  }, [layoutNodes, selectedId, setNodes]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: 280, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutVersion, fitView]);

  const orderedBlockIds = useMemo(
    () =>
      layoutNodes
        .filter((item) => item.data.kind === "block" && item.data.refId)
        .map((item) => item.data.refId as string),
    [layoutNodes],
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      const data = node.data as BuilderNode["data"];
      onSelectBlock(data.kind === "block" ? data.refId : null);
    },
    [onSelectBlock],
  );

  const handleNodeDragStop = useCallback(() => {
    const dragged = [...nodes]
      .filter((item) => item.data.kind === "block" && item.data.refId)
      .sort((a, b) => a.position.y - b.position.y)
      .map((item) => item.data.refId as string);
    const changed =
      dragged.length === orderedBlockIds.length &&
      dragged.some((id, index) => id !== orderedBlockIds[index]);
    if (changed) {
      onReorder(dragged);
      return;
    }
    // Snap back to the deterministic layout.
    setNodes(
      layoutRef.current.map((item) => ({
        ...item,
        selected: item.data.refId !== null && item.data.refId === selectedId,
      })),
    );
  }, [nodes, orderedBlockIds, onReorder, selectedId, setNodes]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.sourceHandle === "branch" && connection.source && connection.target) {
        onConnectBranch(connection.source, connection.target);
      }
    },
    [onConnectBranch],
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    if (event.dataTransfer.types.includes(BLOCK_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      const block = event.dataTransfer.getData(BLOCK_DRAG_MIME) as LibraryBlockKey;
      if (!block) return;
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const blockNodes = layoutRef.current.filter((item) => item.data.kind === "block");
      onDropBlock(block, insertIndexForY(blockNodes, position.y));
    },
    [onDropBlock, screenToFlowPosition],
  );

  const interactions = useMemo(() => ({ onInsertAt }), [onInsertAt]);

  return (
    <CanvasInteractionsContext.Provider value={interactions}>
      <ReactFlow
        data-testid="flow-canvas"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectBlock(null)}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        fitView
        minZoom={0.35}
        maxZoom={1.4}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        selectNodesOnDrag={false}
        deleteKeyCode={null}
        edgesFocusable={false}
        nodesFocusable
        connectionRadius={28}
        connectionLineStyle={{ stroke: "var(--nw-flow-branch)", strokeWidth: 1.5 }}
        className="nwfb-canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.4}
          color="var(--nw-flow-grid)"
        />
        <Controls position="bottom-left" showInteractive={false} className="nwfb-controls" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="nwfb-minimap"
          nodeBorderRadius={10}
        />
      </ReactFlow>
    </CanvasInteractionsContext.Provider>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
