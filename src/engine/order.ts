/** One game as winner and loser, indices into the team array. */
export interface Result {
  winner: number;
  loser: number;
}

/**
 * Moves one team at a time to the place in the order that leaves the fewest upsets
 * (a game whose winner sits below its loser), until no single move lowers the count.
 * Ties between equally good places go to the one nearest the team's current place,
 * then the higher one. Every move removes at least one upset, so this always stops.
 */
export function fewestUpsetsOrder(n: number, results: readonly Result[], start: readonly number[]): number[] {
  const won: number[][] = Array.from({ length: n }, () => []);
  const lost: number[][] = Array.from({ length: n }, () => []);
  for (const b of results) {
    won[b.winner]!.push(b.loser);
    lost[b.loser]!.push(b.winner);
  }
  let order = [...start];
  const pos = new Int32Array(n);
  for (;;) {
    let moved = false;
    for (let t = 0; t < n; t++) {
      if (won[t]!.length + lost[t]!.length === 0) continue;
      const cur = order.indexOf(t);
      const rest = order.slice(0, cur).concat(order.slice(cur + 1));
      rest.forEach((x, i) => (pos[x] = i));
      // Inserting t at place p puts it above rest[p..]. At p = 0 every loss is an
      // upset; stepping below a team that beat t removes one, below a team t beat adds one.
      const step = new Int32Array(rest.length + 1);
      for (const x of lost[t]!) step[pos[x]! + 1]! -= 1;
      for (const x of won[t]!) step[pos[x]! + 1]! += 1;
      let cost = lost[t]!.length;
      let best = cost, bestP = 0, curCost = cost;
      for (let p = 1; p <= rest.length; p++) {
        cost += step[p]!;
        if (p === cur) curCost = cost;
        if (cost < best || (cost === best && Math.abs(p - cur) < Math.abs(bestP - cur))) {
          best = cost;
          bestP = p;
        }
      }
      if (best < curCost) {
        rest.splice(bestP, 0, t);
        order = rest;
        moved = true;
      }
    }
    if (!moved) return order;
  }
}
