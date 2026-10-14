# Seven-point, two-way game-spring ranking

The active method is `two-sided-springs-v1`, with `springGap: 7`. Only this season's completed, non-tied results enter the graph. Every game has equal weight; scores identify the winner but do not set its spring length.

## Force and equilibrium

Each team is a node. Each game is a spring whose desired height difference is winner minus loser = seven:

```text
gap             = height[winner] - height[loser]
force on winner = 7 - gap
force on loser  = -force on winner
energy          = ½ × sum over games of (7 - gap)²
```

A gap below seven pushes the winner upward and the loser downward. A gap above seven pulls the winner downward and loser upward. A gap of seven exerts no force. Both directions matter: unlike a one-sided spring, an already separated game can still pull its teams back together.

All teams start at zero. Simultaneous gradient relaxation uses component-local step `1 / (2 × maximum game count)`, counting repeated meetings separately. This step cannot increase the convex quadratic energy. Stop when every net force is at most `1e-10`, and throw if 2,000,000 iterations cannot reach equilibrium. Each connected component is centered at mean zero.

This is graph least squares with a fixed binary result target. Its normal equations are:

```text
degree[i] × height[i] - sum(height[opponent] for each game)
    = 7 × (wins[i] - losses[i])

height[i] = average opponent height + 7 × (wins[i] - losses[i]) / games[i]
```

The graph Laplacian has only translation freedom within a connected component. Centering removes that freedom, so the two-way equilibrium is unique per connected component. Numeric IDs fix serialization order and label nodes; they do not add strength.

## What seven changes

A common positive rest gap sets scale. Replacing one with seven multiplies all unrounded heights and residual forces by seven and energy by 49; the ordering is the same. The change from the previous ranking comes from allowing two-way attraction, rather than the number seven alone. Tests verify this scaling and the normal equations.

The units are graph-height points, not calibrated scoring margins or win probabilities. Score margin, home advantage, division strength, polls, previous-season data, neural weights and separate loss deductions are unused.

## Head-to-head tradeoff

The fit minimizes total squared gap error across **all** games. It does not enforce that every winner must rank above its loser. Cycles force compromises, but even without a cycle a team can be pulled below a team it beat when other games favor that arrangement. Even an undefeated team can rank below a team with losses. Wins against weak opponents can pull an already high team downward because every game asks for exactly seven points of separation.

In the 2026 Week 6 results, Georgia beat Alabama and the game is included. Its spring pushes Georgia up and Alabama down by 8.256014 units. Georgia's wins against Tennessee State and Western Kentucky pull Georgia down by 8.578995 and 4.909124 units because their fitted gaps exceed seven. Alabama's other opponents, including Kentucky and Mississippi State, establish a higher opponent average. The resulting equilibrium places Alabama #2 at 12.637356 and Georgia #8 at 11.381342.

A rule that always keeps a winner above its loser outside contradictory cycles would be a different, constrained ranking. This version reports the pure two-way spring result without inserting a special Georgia/Alabama override.

Examples:

- A beats B: heights `(+3.5, -3.5)`.
- A beats B and B beats C: `(7, 0, -7)`.
- Add A beating C: the three exact seven-point targets conflict. Heights become `(14/3, 0, -14/3)`. The direct A–C spring is stretched and pulls A downward.
- A beats B, B beats C, C beats A: all heights zero, energy `73.5`.
- A beats B twice, B beats A once: heights `(+7/6, -7/6)`.

## Scope, chronology and publication

Use completed non-tied games supplied in `games.csv`, with a six-hour result-availability lag after kickoff and independent calendar-cutoff snapshots. Actual outside opponents join as equal nodes. Only teams in configured publication classifications receive ranks. Supporting nodes retain their heights and records. Ties create no winner edge; unplayed teams stay unranked. Missing opponent schedules are not inferred.

Disconnected components are each centered at zero, but games cannot establish their relative level. Combined ranks remain provisional in that situation. Publish heights to six decimals, sort descending and preserve equal heights as competition ranks (`1, 1, 3, ...`). Conference lanes affect only the horizontal display.

`manifest.springs` records direction, rest gap, solver, convergence, energy, compression/extension counts and head-to-head reversals. Each entry in `springs[]` records one game's endpoints, gap, compression, extension, **signed force on the winner**, and energy. The loser receives the opposite force. Team pages use those signed forces, including downward pulls from stretched wins. Predictions, point credits and projections remain inactive.

## Verification

```sh
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-springs -- 2026
npm run build
```

Tests cover hand-solved push and pull examples, cycles, repeated meetings, seven-to-one scaling, Laplacian normal equations, normalization, identifiers, causal cutoffs and record/rank reconciliation. The audit reconstructs signed forces and energy from rounded heights. Exact byte verification and the browser recompute bind all six snapshots to their raw source files.

[Current Week 6 report](../research/springs/2026/REPORT.md), [full rankings](../research/springs/2026/week-06-rankings.csv), [audit](../research/springs/2026/audit.json). The previous [one-sided method](./ONE_SIDED_SPRINGS.md) and [Week 6 output](../research/springs/2026/one-sided-v1/week-06.json) remain archived. Neural studies remain under [research](../research/season_only/README.md); their historical accuracy figures do not evaluate this graph method.
