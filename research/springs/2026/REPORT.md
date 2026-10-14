# 2026 7-point spring graph with strong-win support

Through Week 6, cutoff 2026-10-11T08:30:00.000Z. 812 completed non-tied games connect 266 published FBS/FCS teams and 52 supporting opponents.

Every game has a desired winner–loser gap of 7 points. Compressed springs keep full stiffness. Stretched springs pull teams together with strength-based stiffness: stronger wins support a team against downward pulls from wins over weaker opponents. Weights come from an equal-spring current-season reference graph, are frozen before the final fit, and use no team identity, score margin, venue, division prior, historical season or neural estimate.

582 springs are compressed and 188 are stretched. 75 winners are below their losers and 0 are level (1e-6 display tolerance). Conflicting paths and cycles require compromises. Equal published heights share a competition rank.

For each winner, let d be the reference-strength difference between its strongest beaten opponent and this beaten opponent. Pull stiffness k = 2^(−max(0,d)/7). The strongest win has k = 1; each seven-point difference halves a weaker win's downward pull. Minimize ½ × sum(compression² + k × extension²). The loser receives the opposite force, and all compression keeps stiffness one. Frozen positive weights keep the objective convex and each centered component's equilibrium unique.

This implements the requested ranking policy rather than proving predictive superiority. Head-to-head order is still not guaranteed. See the [five-policy comparison](./STIFFNESS_COMPARISON.md), [full comparison data](./stiffness-comparison.json), and [methodology](../../../docs/METHODOLOGY.md). The comparison includes the Georgia–Alabama example and a sensitivity variant that reverses their order.

| Rank | Team | Record | Height |
| --- | --- | --- | --- |
| 1 | Georgia | 6–0 | 16.361594 |
| 2 | Alabama | 5–1 | 16.172303 |
| 3 | Miami | 5–0 | 15.409722 |
| 4 | Notre Dame | 6–0 | 15.007600 |
| 5 | UCLA | 5–0 | 14.587062 |
| 6 | Mississippi State | 4–1 | 14.492143 |
| 7 | Kentucky | 5–1 | 14.248328 |
| 8 | Texas | 4–1 | 14.238438 |
| 9 | Texas Tech | 5–0 | 13.761486 |
| 10 | Indiana | 6–0 | 13.403740 |
| 11 | BYU | 5–0 | 12.826764 |
| 12 | Wake Forest | 5–1 | 12.548569 |
| 13 | Ole Miss | 4–1 | 12.057597 |
| 14 | Missouri | 5–1 | 11.916315 |
| 15 | Ohio State | 5–1 | 11.775708 |
| 16 | Florida | 4–2 | 11.447993 |
| 17 | LSU | 4–2 | 11.340093 |
| 18 | Oklahoma | 3–2 | 11.248279 |
| 19 | Boise State | 5–1 | 11.155294 |
| 20 | Northwestern | 4–1 | 11.118235 |
| 21 | Iowa | 5–1 | 11.061549 |
| 22 | Oregon | 3–2 | 10.897207 |
| 23 | Utah | 5–0 | 10.891347 |
| 24 | Tennessee | 5–1 | 10.814459 |
| 25 | Houston | 5–1 | 10.643484 |

Full field: [CSV](./week-06-rankings.csv). [Every snapshot audit](./audit.json). [Math, normalization and limits](../../../docs/METHODOLOGY.md).

The audit reconstructs each edge, record, rank, component mean, spring force and energy from the published heights. The full-precision stopping tolerance is 1e-10; rounding to six decimals introduces a small auditable residual. `npm run verify` separately recomputes the exact serialized files from raw input.
