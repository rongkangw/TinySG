export interface LandUseColour {
  night: string;
  day: string;
  outline: string;
}

export interface LandUseLightStyle {
  density: number;
  colours: string[];
  size: number;
}

export const LAND_USE_COLOURS: Record<string, LandUseColour> = {
  residential: { night: "#33414e", day: "#526579", outline: "#7894ad" },
  commercial: { night: "#493d50", day: "#66536d", outline: "#9a7da4" },
  industrial: { night: "#41464a", day: "#596168", outline: "#89949c" },
  civic: { night: "#394657", day: "#52637a", outline: "#829ab8" },
  recreation: { night: "#294a3a", day: "#3f6752", outline: "#6b9a7d" },
  development: { night: "#4d4234", day: "#6d5b44", outline: "#a58a64" },
  agriculture: { night: "#3e4934", day: "#576347", outline: "#86966b" },
  military: { night: "#493a42", day: "#64505a", outline: "#997684" },
  water: { night: "#071923", day: "#123244", outline: "#1f4b60" },
  transport: { night: "#3b4047", day: "#555c65", outline: "#858f9b" },
};

export const LAND_USE_LIGHTS: Record<string, LandUseLightStyle> = {
  residential: {
    density: 34,
    colours: ["#ffd7a3", "#ffc786", "#f5e3bf", "#ffb979"],
    size: 0.68,
  },
  commercial: {
    density: 48,
    colours: ["#dcf7ff", "#94dcff", "#ffe59d", "#c9f0ff"],
    size: 0.78,
  },
  industrial: {
    density: 22,
    colours: ["#ffbd67", "#df8d4a", "#d8e2e8", "#f0a15c"],
    size: 0.68,
  },
  civic: {
    density: 18,
    colours: ["#f6ddb0", "#d7e6ff", "#fff1cf"],
    size: 0.7,
  },
  recreation: {
    density: 8,
    colours: ["#8bd6a5", "#c3e997", "#f5d98c", "#77c994"],
    size: 0.56,
  },
  development: {
    density: 13,
    colours: ["#ff9e5e", "#ffc56e", "#ff6f5e"],
    size: 0.62,
  },
  agriculture: {
    density: 3,
    colours: ["#d6d98b", "#f2ca7c"],
    size: 0.58,
  },
  military: {
    density: 5,
    colours: ["#ff806f", "#d96761"],
    size: 0.6,
  },
  transport: {
    density: 36,
    colours: ["#b7e5ff", "#77bfff", "#f8e39f", "#ffffff"],
    size: 0.7,
  },
};
