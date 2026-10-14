# Seven-point springs with strong-win support

The active method is `supported-springs-v1`, with `springGap: 7`. It uses only the current season's completed non-tied game results. Each game is a spring pointing from loser to winner. A team's stronger wins reduce the downward pull from its weaker wins.

## Two passes, with frozen stiffness

1. Fit an equal-stiffness, two-way graph with a seven-point target for every game. This produces current-season reference strengths `s`. Every node starts at zero, with no division prior or team identity feature.
2. For each winning team, find the strongest reference opponent it has beaten: `best[w] = max(s[opponent] for wins by w)`.
3. For each game won by `w` over `l`, set its **stretched-pull stiffness**:

```text
d = max(0, best[w] - s[l])
k = 2 ^ (-d / 7)
```

4. Freeze these positive weights and settle the graph again from zero. Do not update stiffness as the final heights move.

The strongest win has stiffness one. A win against an opponent seven reference points weaker has half as much downward pull; fourteen points weaker has one quarter. A team without stronger wins receives no such discount on its strongest win. The rule depends on within-component strength differences, so changing the component's arbitrary zero has no effect. No floor parameter is used.

This is one concrete, transparent weighting policy. The exponential shape is a design choice matching the requested protection, rather than a discovered law of football or a historically calibrated optimum.

## Physical forces and objective

Every game prefers its winner seven graph-height points above its loser:

```text
gap             = height[winner] - height[loser]
compression     = max(0, 7 - gap)
extension       = max(0, gap - 7)
force on winner = compression - k * extension
force on loser  = -force on winner
energy          = ½ × sum(compression² + k × extension²)
```

A compressed spring always keeps stiffness one: it pushes the winner upward and loser downward with full force. This includes a loss where a loser is incorrectly above the winner. Only the negative force of a stretched winning gap is softened. Strength determines spring **stiffness**, not a signed coefficient derived directly from a possibly negative team height.

The coefficient `k` belongs in the energy once, rather than squaring the force: force is the negative derivative of this energy. Tests verify this with a hand-solved graph.

The frozen objective is convex and differentiable. Each edge has strictly positive stiffness in both directions, so centering removes its connected component's only translation freedom. The centered equilibrium is unique. Simultaneous gradient relaxation uses component-local step `1 / (2 × maximum game count)`, counting repeated meetings separately. Since `0 < k <= 1`, the existing inverse Lipschitz bound remains valid. Stop when every net force is at most `1e-10`; fail after 2,000,000 iterations instead of publishing an unconverged fit. Both reference and final fits record their convergence.

## Head-to-head tradeoff

The model minimizes total spring energy, with no hard rule forcing every winner above its loser. Cycles and competing results still require compromises. Softening weak-opponent attraction helps preserve stronger wins, but cannot guarantee every head-to-head order or make the ranking uniquely deserving.

On 2026 Week 6, the equal-spring model placed Alabama #2 and Georgia #8 even though Georgia won their game. Georgia's Tennessee State and Western Kentucky wins pulled it down by 8.58 and 4.91 units. Strong-win support gives those games pull stiffness of about 19% and 27%, based on the stronger Alabama win. After the whole graph settles, their combined downward pull falls from 13.49 to 6.22 units. Georgia becomes #1 and Alabama #2, with only about 0.19 height units separating them.

The [five-policy comparison](../research/springs/2026/STIFFNESS_COMPARISON.md) includes a variant with a 25% minimum pull stiffness, which puts Alabama narrowly back above Georgia. That sensitivity is why the result is described as a soft ranking policy rather than a head-to-head guarantee. No Georgia-specific override enters the engine.

## Why this rule

A flat discount weakens every stretched pull, even the strongest wins. Absolute opponent-strength weighting depends on a component's arbitrary center. The selected relative rule directly answers “punish weak opponents less when there are stronger wins”: it compares each beaten opponent with the winner's best beaten opponent, and uses only relative reference strengths within the same connected component.

The comparison is retrospective: these candidate policies were inspected on the same Week 6 results. It does not establish improved future-game accuracy or superiority to betting odds. The final ranking remains a results graph, without calibrated winner probabilities or scoring-margin forecasts.

## Scale, scope and chronology

Seven sets the height scale. Scaling the common rest gap scales reference heights, final heights and forces by the same factor; the ratio in `k` stays unchanged. The unrounded ordering is unchanged. Scores determine only the winner: margin, venue, polls, preseason evidence, previous seasons, conference/division strength and neural predictions are unused.

Use only supplied completed non-tied games available by each calendar cutoff, assuming results arrive six hours after kickoff. Every snapshot is rebuilt independently, including its reference weights. Future results cannot alter an earlier fit. Actual outside opponents participate equally. Only configured publication classifications receive ranks. Missing opponent schedules are not invented, ties create no winner edge, and unplayed teams remain unranked.

Each connected component is centered at mean zero. Games cannot establish relative levels across disconnected components, so combined ranks remain provisional. Publish heights to six decimals, sort descending and preserve equal heights as competition ranks (`1, 1, 3, ...`). Horizontal conference lanes are cosmetic.

## Artifacts and checks

`manifest.springs` records rest gap, direction, `pullPolicy: best-win-relative-v1`, stiffness range, reference/final convergence, energy and conflicts. Every game in `springs[]` stores endpoints, gap, compression, extension, pull stiffness, signed force on the winner, energy, and reference opponent/best-win strengths. Team game logs show each stiffness; the loser receives the opposite signed force. Predictions, earned credits and projections remain inactive.

```sh
npm run typecheck
npm test
npm run compute
npm run verify
npm run audit-springs -- 2026
npm run compare-springs -- 2026
npm run build
```

Tests cover push/pull energy, strongest-win weights, reference freezing, full compression pressure, scale/relabeling/order independence, causal cutoffs and record reconciliation. Audits reconstruct weighted forces and energy from rounded public heights. The browser runs the same engine and can verify every snapshot byte for byte.

[Current rankings](../research/springs/2026/REPORT.md), [full comparison data](../research/springs/2026/stiffness-comparison.json), [audits](../research/springs/2026/audit.json). The [previous equal two-way model](./TWO_SIDED_SPRINGS.md) and [one-sided model](./ONE_SIDED_SPRINGS.md) remain archived alongside their outputs. Earlier [neural research](../research/season_only/README.md) evaluates different methods.
