export interface MapCamera {
  zoom: number;
  x: number;
  y: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface CameraTransform {
  scale: number;
  originX: number;
  originY: number;
}

export function cameraTransform(
  camera: MapCamera,
  viewport: ViewportSize,
): CameraTransform {
  const base = Math.min(viewport.width, viewport.height) * 1.08;
  const scale = base * camera.zoom;
  return {
    scale,
    originX: viewport.width / 2 - scale / 2 + camera.x,
    originY: viewport.height / 2 - scale / 2 + camera.y,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: CameraTransform,
) {
  return {
    x: (screenX - transform.originX) / transform.scale,
    y: (screenY - transform.originY) / transform.scale,
  };
}

export function zoomCameraAt(
  camera: MapCamera,
  viewport: ViewportSize,
  screenX: number,
  screenY: number,
  nextZoom: number,
): MapCamera {
  const previous = cameraTransform(camera, viewport);
  const world = screenToWorld(screenX, screenY, previous);
  const nextScale =
    Math.min(viewport.width, viewport.height) * 1.08 * nextZoom;
  return {
    zoom: nextZoom,
    x:
      screenX -
      world.x * nextScale -
      (viewport.width / 2 - nextScale / 2),
    y:
      screenY -
      world.y * nextScale -
      (viewport.height / 2 - nextScale / 2),
  };
}

export function cameraForWorldFocus(
  worldX: number,
  worldY: number,
  zoom: number,
  viewport: ViewportSize,
): MapCamera {
  const scale =
    Math.min(viewport.width, viewport.height) * 1.08 * zoom;
  return {
    zoom,
    x: scale * (0.5 - worldX),
    y: scale * (0.5 - worldY),
  };
}
