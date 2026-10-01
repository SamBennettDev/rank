/** Nominal height of the graph canvas, in layout units (renderers scale it). */
export const LAYOUT_HEIGHT = 900;
const DIAMETER = 14;
const LANE_WIDTH = 90;
const STEP = 2;

/** Vertical position for a height: the best team is at 0 (top), the worst at LAYOUT_HEIGHT. */
export function layoutY(height: number, min: number, max: number): number {
  return max === min ? LAYOUT_HEIGHT / 2 : ((max - height) / (max - min)) * LAYOUT_HEIGHT;
}

/**
 * Deterministic horizontal placement. y is fixed by height. x puts each conference
 * in its own lane (lanes ordered alphabetically); teams that would overlap inside a
 * lane are nudged sideways, best to worst. Pure arithmetic with no randomness, so
 * every machine computes identical coordinates. x carries no ranking meaning.
 */
export function layoutX(
  heights: ReadonlyMap<number, number>,
  lanes: ReadonlyMap<number, string>,
): Map<number, number> {
  const ids = [...heights.keys()].sort((a, b) => heights.get(b)! - heights.get(a)! || a - b);
  const values = [...heights.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);

  const names = [...new Set(ids.map((id) => lanes.get(id) ?? ""))].sort();
  const center = (name: string) => (names.indexOf(name) - (names.length - 1) / 2) * LANE_WIDTH;

  const placed: { x: number; y: number }[] = [];
  const xs = new Map<number, number>();
  for (const id of ids) {
    const y = layoutY(heights.get(id)!, min, max);
    const home = center(lanes.get(id) ?? "");
    const free = (x: number) => {
      for (let i = placed.length - 1; i >= 0; i--) {
        const p = placed[i]!;
        const dy = y - p.y;
        if (dy >= DIAMETER) break;
        const dx = x - p.x;
        if (dx * dx + dy * dy < DIAMETER * DIAMETER) return false;
      }
      return true;
    };
    let x = home;
    for (let k = 1; !free(x); k++) x = home + (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * STEP;
    x = Math.round(x * 100) / 100;
    placed.push({ x, y });
    xs.set(id, x);
  }
  return xs;
}
