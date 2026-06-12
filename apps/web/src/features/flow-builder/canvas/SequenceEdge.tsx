import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { createContext, useContext } from "react";

interface CanvasInteractions {
  onInsertAt: (index: number) => void;
}

export const CanvasInteractionsContext = createContext<CanvasInteractions>({
  onInsertAt: () => undefined,
});

/** Sequence edge with a hover "+" affordance to insert a block in place. */
export function SequenceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { onInsertAt } = useContext(CanvasInteractionsContext);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });
  const insertIndex = typeof data?.insertIndex === "number" ? data.insertIndex : null;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd as string | undefined} />
      {insertIndex !== null ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nwfb-edge-add nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title="Inserir bloco aqui"
            onClick={(event) => {
              event.stopPropagation();
              onInsertAt(insertIndex);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
