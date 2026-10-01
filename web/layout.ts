/**
 * Graph geometry. Vertical position IS the ranking height (best at the top).
 * Horizontal position is cosmetic: one lane per conference, lanes ordered by the
 * conference's mean height (deterministic, ties by name), with teams nudged
 * sideways inside a lane only when their logos would overlap.
 */

export interface LayoutInput {
  id: number;
  height: number;
  lane: string;
}

export interface Lane {
  name: string;
  x: number;
  count: number;
  meanHeight: number;
}

export interface Layout {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  lanes: Lane[];
  pos: Map<number, { x: number; y: number }>;
  y: (height: number) => number;
}

export function computeLayout(nodes: readonly LayoutInput[], opts: { node: number; laneWidth: number; plotHeight: number }): Layout {
  const { node, laneWidth, plotHeight } = opts;
  const top = 120;
  const bottom = 40;
  const left = 64;
  const heights = nodes.map((n) => n.height);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const y = (h: number) => (max === min ? top + plotHeight / 2 : top + ((max - h) / (max - min)) * plotHeight);

  const groups = new Map<string, LayoutInput[]>();
  for (const n of nodes) (groups.get(n.lane) ?? groups.set(n.lane, []).get(n.lane)!).push(n);
  const lanes: Lane[] = [...groups.entries()]
    .map(([name, list]) => ({ name, x: 0, count: list.length, meanHeight: list.reduce((s, n) => s + n.height, 0) / list.length }))
    .sort((a, b) => b.meanHeight - a.meanHeight || a.name.localeCompare(b.name));
  lanes.forEach((l, i) => (l.x = left + laneWidth * (i + 0.5)));

  const pos = new Map<number, { x: number; y: number }>();
  const gap = node + 3;
  for (const lane of lanes) {
    const list = [...groups.get(lane.name)!].sort((a, b) => b.height - a.height || a.id - b.id);
    const placed: { x: number; y: number }[] = [];
    for (const n of list) {
      const ny = y(n.height);
      const free = (x: number) => placed.every((p) => (x - p.x) ** 2 + (ny - p.y) ** 2 >= gap * gap);
      let x = lane.x;
      for (let k = 1; !free(x) && k < 200; k++) x = lane.x + (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * 3;
      placed.push({ x, y: ny });
      pos.set(n.id, { x, y: ny });
    }
  }
  return { width: left + laneWidth * lanes.length + 24, height: top + plotHeight + bottom, top, bottom, left, lanes, pos, y };
}
