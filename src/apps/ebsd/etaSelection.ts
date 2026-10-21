/** Four-connected IQ selection, matching the analysis grid exactly. */
export function smartSelect(mask: Uint8Array, iq: Float32Array, valid: Uint8Array, width: number, height: number, x: number, y: number, tolerance: number, erase = false) {
  const seed = y * width + x;
  if (!valid[seed] || !Number.isFinite(iq[seed]) || (erase && !mask[seed])) return;
  const visited = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  const reference = iq[seed]; let head = 0, tail = 0;
  const add = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    if (!valid[index] || !Number.isFinite(iq[index]) || (erase && !mask[index]) || Math.abs(iq[index] - reference) > tolerance) return;
    queue[tail++] = index;
  };
  add(seed);
  while (head < tail) {
    const index = queue[head++], col = index % width;
    mask[index] = erase ? 0 : 1;
    if (col > 0) add(index - 1);
    if (col + 1 < width) add(index + 1);
    if (index >= width) add(index - width);
    if (index + width < width * height) add(index + width);
  }
}

export function paintStroke(mask: Uint8Array, valid: Uint8Array, width: number, height: number, from: [number, number], to: [number, number], diameter: number, erase: boolean) {
  const radius = Math.max(.5, diameter / 2);
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(distance / Math.max(.5, radius / 2)));
  for (let i = 0; i <= steps; i++) {
    const cx = from[0] + (to[0] - from[0]) * i / steps, cy = from[1] + (to[1] - from[1]) * i / steps;
    for (let y = Math.max(0, Math.ceil(cy - radius)); y <= Math.min(height - 1, Math.floor(cy + radius)); y++) {
      for (let x = Math.max(0, Math.ceil(cx - radius)); x <= Math.min(width - 1, Math.floor(cx + radius)); x++) {
        const index = y * width + x;
        if (valid[index] && (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) mask[index] = erase ? 0 : 1;
      }
    }
  }
}
