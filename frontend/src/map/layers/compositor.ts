import {
  LAYER_Z_INDEX,
  type LayerId,
} from "./order";

export interface LayerDrawCommand {
  id: LayerId;
  draw(context: CanvasRenderingContext2D): void;
}

/**
 * Draws a scene from the canonical z-order and isolates mutable canvas state
 * for every feature. Layer implementations cannot leak alpha, shadows, clips,
 * or transforms into the feature above them.
 */
export function renderLayerStack(
  context: CanvasRenderingContext2D,
  commands: readonly LayerDrawCommand[],
) {
  const ordered = [...commands].sort(
    (left, right) =>
      LAYER_Z_INDEX[left.id] - LAYER_Z_INDEX[right.id],
  );
  ordered.forEach((command) => {
    context.save();
    try {
      command.draw(context);
    } finally {
      context.restore();
    }
  });
}
