# Raw one-sided game-spring ranking

The active method is `one-sided-springs-v1`. It uses only the current season's completed, non-tied results. It is a graph of result constraints, with no trained or calibrated parameters.

## Nodes, edges and forces

A team has one node identified by its unique numeric ID. Names, conferences and logos label the display and never affect forces. Every counted game contributes its own directed edge from loser to winner; repeated meetings are separate, equally weighted edges. Actual outside opponents are ordinary supporting nodes with the same zero start.

Let `h[w]` and `h[l]` be the winner's and loser's heights. Define:

```text
gap         = h[w] - h[l]
compression = max(0, 1 - gap)
energy      = ½ × sum over games of compression²
```

The unit gap sets the measurement scale and prevents the trivial all-zero solution for a lone game. A compressed spring pushes its winner up by its compression and pushes its loser down by the same amount. Once the gap is at least one, the spring is slack and exerts no force. It never pulls an already-separated pair back together.

All teams start at zero for every snapshot. No neural network, scoreboard margin, home advantage, prior-season evidence, division prior, separate win reward or separate loss deduction enters the calculation. Scores determine only who won. A loss participates fully through its spring; once that game's winner is sufficiently far above its loser, the game adds no further pressure.

## Settling and normalization

The implementation uses simultaneous gradient relaxation. In each connected group, every node moves along its total force with step size `1 / (2 × maximum node degree)`, counting repeated games in the degree. This is a conservative inverse Lipschitz bound for the convex squared-hinge energy, so a relaxation cannot increase energy. Component-local steps ensure an unrelated disconnected group does not alter another group's relaxation path.

Stop only when the largest absolute net force is at most `1e-10`. The limit is 2,000,000 iterations; nonconvergence throws an error rather than publishing an unconverged standing. This is a numerical tolerance, not a learned sports setting. Because the objective is convex, a zero net force certifies a global minimum; the implementation stops within the published force tolerance.

Equal and opposite forces conserve each component's mean. At the end, remove floating-point drift by centering each connected component at zero. Translation changes neither gaps nor energy. Do not normalize each team or scale gaps after fitting.

The energy can have multiple minimizers when springs are slack. Mean centering removes translation, but does not always remove this remaining freedom. The documented equal-zero initialization and fixed, simultaneous relaxation select a reproducible equilibrium. This is not a claim of a unique mathematical minimizer or a minimum-span layout. Numeric IDs fix stable iteration/serialization order; they do not add strength. Tests verify relabeling invariance within numerical tolerance.

## Chains, cycles and ties

- One game, A beating B: heights `(+0.5, −0.5)`.
- A beats B and B beats C: heights `(1, 0, −1)`.
- Add A beating C: its two-unit gap is already separated, so that extra spring can become slack.
- A beats B, B beats C, C beats A: heights `(0, 0, 0)`, energy `1.5`. All three springs are compressed, but their forces balance.
- A beats B twice and B beats A once: the optimum gap is `1/3`, with heights `(+1/6, −1/6)` and energy `4/3`.

An acyclic results graph can satisfy all its spring constraints. A directed cycle cannot: summing its desired positive gaps around the cycle would require zero to be positive. Cycles therefore require a compromise and can leave winners tied with or below losers. Squared compression minimizes the severity of shortfalls; it does **not** promise the smallest number of reversed games.

Long chains can create large height differences. Teams with different records can tie, or an unbeaten team can sit below a team with losses because its opponents anchor a different part of the graph. An additional win gives no ongoing force after that spring becomes slack. Those behaviors follow directly from the requested raw graph objective.

Heights are published to six decimals, and descending published heights determine competition ranks: `1, 1, 3, ...`. Equal heights share a rank. Team IDs order tied rows only. Graph vertical positions use these actual heights, rather than an ordinal rank coordinate. Horizontal conference lanes and overlap avoidance are cosmetic.

## Data scope and chronology

The graph includes the games supplied in `games.csv`, with actual outside opponents added as nodes. Only teams in `teams.csv` whose classifications match the configuration receive ranks. Supporting nodes have heights and records but no published rank. No division or conference receives a bonus. The pipeline does not invent missing opponent schedules.

Every snapshot is rebuilt independently from completed results available by its calendar cutoff. A result is assumed available six hours after kickoff, matching the repository's established chronology. Future results, conditional matchups and incomplete scores contribute no spring to an earlier snapshot. A tied score has no winner and contributes no edge; the manifest counts it separately. Unplayed teams remain unranked.

Every connected component is centered separately. There is no result evidence to establish the relative level of disconnected components. Combined ranks remain provisional in that situation; no artificial cross-component games or preseason strength estimates are inserted.

## Publication and verification

`manifest.springs` records rest gap, equal-zero initialization, component normalization, solver, stopping tolerance, iteration count, net-force residual, energy and conflict counts. `springs[]` has one entry per counted game, storing endpoints, gap, compression and energy. `teams[]` stores actual heights, ranks and reconciled win/loss records. Supporting nodes appear under `opponents[]`.

Predictions and credits are empty; projections use `method: none`. Legacy manifest numeric fields are zero/inactive, retained for schema compatibility. Scores, plays and saved neural exports do not enter the spring fit. The minimal active configuration selects the method and publication classifications.

Run:

```sh
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-springs -- 2026
npm run build
```

Tests cover hand-solvable examples, slack edges, repeated games, normalization, relabeling, duplicated/corrupt input, score/venue independence, future-result isolation and publication reconciliation. The audit independently reconstructs forces and energy from the rounded public heights and checks every record, rank and edge. Rounding creates a small force residual; full-precision convergence is recorded separately. Byte verification reproduces every serialized ranking from raw source bytes. The Method page runs the same reconstruction engine in the browser.

[Current Week 6 report](../research/springs/2026/REPORT.md) and [audit](../research/springs/2026/audit.json). Historical neural experiments are retained in [NEURAL_V2.md](./NEURAL_V2.md), [NEURAL_V1.md](./NEURAL_V1.md) and [research](../research/season_only/README.md). Those studies evaluate different predictive models and do not establish the prediction accuracy of this results graph.
