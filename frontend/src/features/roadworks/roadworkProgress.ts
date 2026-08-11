function roadworkTimestamp(value?: string) {
  if (!value) return null;
  const dotNet = /\/Date\((-?\d+)/i.exec(value);
  const parsed = dotNet ? Number(dotNet[1]) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roadworkCompletion(
  startDate?: string,
  endDate?: string,
  nowEpochMs = Date.now(),
) {
  const start = roadworkTimestamp(startDate);
  const end = roadworkTimestamp(endDate);
  if (start === null || end === null || end <= start) return null;
  return Math.max(0, Math.min(1, (nowEpochMs - start) / (end - start)));
}

export function formatRoadworkDate(value?: string) {
  const timestamp = roadworkTimestamp(value);
  if (timestamp === null) return value ?? "";
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}
