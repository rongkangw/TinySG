export function blendHex(left: string, right: string, amount: number) {
  const parse = (colour: string) => [
    parseInt(colour.slice(1, 3), 16),
    parseInt(colour.slice(3, 5), 16),
    parseInt(colour.slice(5, 7), 16),
  ];
  const from = parse(left);
  const to = parse(right);
  const value = Math.max(0, Math.min(1, amount));
  return `rgb(${from
    .map((channel, index) => Math.round(channel + (to[index] - channel) * value))
    .join(",")})`;
}

export function singaporeHourAt(epochMs: number) {
  const date = new Date(epochMs);
  return (
    (date.getUTCHours() + 8) % 24 +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600
  );
}

export function daylightAt(epochMs: number) {
  const singaporeHour = singaporeHourAt(epochMs);
  const smoothstep = (start: number, end: number, value: number) => {
    const phase = Math.max(0, Math.min(1, (value - start) / (end - start)));
    return phase * phase * (3 - 2 * phase);
  };
  const dawn = smoothstep(6, 7.5, singaporeHour);
  const dusk = 1 - smoothstep(18.5, 20, singaporeHour);
  return dawn * dusk;
}
