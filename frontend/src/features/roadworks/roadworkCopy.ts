export function cleanRoadworkMessage(message: string) {
  return message
    .replace(/\s*(?:[-–—|·]\s*)?for all details\b.*$/i, "")
    .trim();
}
