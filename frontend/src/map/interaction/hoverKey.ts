import type { RoadEdge } from "../../types";

export function isMajorRoadHoverClass(highwayClass: string) {
  if (highwayClass.endsWith("_link")) return false;
  return ["motorway", "trunk", "primary"].includes(highwayClass);
}

export function roadHoverKey(road: string, highwayClass: string) {
  return `${road}\u0000${highwayClass}`;
}

export function roadEdgeHoverKey(edge: RoadEdge) {
  return edge.road
    ? roadHoverKey(edge.road, edge.highway_class)
    : `edge\u0000${edge.id}`;
}
