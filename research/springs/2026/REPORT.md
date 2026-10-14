# 2026 7-point two-sided spring graph

Through Week 6, cutoff 2026-10-11T08:30:00.000Z. 812 completed non-tied games connect 266 published FBS/FCS teams and 52 supporting opponents.

Every game has equal weight and a desired winner–loser gap of 7 points. Minimize half the sum of squared gap errors. Compressed springs push teams apart; stretched two-sided springs pull them together. All nodes start at zero; simultaneous spring forces settle the graph. Every connected group is centered at zero. Score margin, site, historical seasons, neural weights and division priors are unused.

622 springs are compressed and 148 are stretched. 83 winners are below their losers and 0 are level (1e-6 display tolerance). Conflicting paths and cycles require compromises. Equal published heights share a competition rank.

This is a results-constraint ranking, with no calibrated win probabilities or claimed betting-market advantage. Two-sided springs have a unique centered equilibrium per connected component. A common positive rest gap sets the height scale; changing it from one to seven multiplies heights by seven without changing the unrounded ordering. The new order comes from allowing stretched springs to pull teams together. Disconnected groups cannot be compared from games alone.

Head-to-head order is not guaranteed, even outside cycles: an exact-gap spring can pull a winner down after a win against a much lower team. See the [head-to-head explanation](../../../docs/METHODOLOGY.md#head-to-head-tradeoff), including the Georgia–Alabama result. The normal equation is height = average opponent height + rest gap × (wins − losses) / games.

| Rank | Team | Record | Height |
| --- | --- | --- | --- |
| 1 | Notre Dame | 6–0 | 13.147545 |
| 2 | Alabama | 5–1 | 12.637356 |
| 3 | UCLA | 5–0 | 12.614239 |
| 4 | Texas | 4–1 | 12.318194 |
| 5 | Miami | 5–0 | 12.044612 |
| 6 | Kentucky | 5–1 | 11.864540 |
| 7 | Texas Tech | 5–0 | 11.619805 |
| 8 | Georgia | 6–0 | 11.381342 |
| 9 | Mississippi State | 4–1 | 10.870361 |
| 10 | Indiana | 6–0 | 10.718637 |
| 11 | Wake Forest | 5–1 | 10.558406 |
| 12 | Boise State | 5–1 | 10.355211 |
| 13 | BYU | 5–0 | 10.266881 |
| 14 | Ohio State | 5–1 | 10.161231 |
| 15 | Missouri | 5–1 | 9.701552 |
| 16 | USC | 6–1 | 9.686454 |
| 17 | Iowa | 5–1 | 9.635084 |
| 18 | Nebraska | 5–1 | 9.594625 |
| 19 | Northwestern | 4–1 | 9.553672 |
| 20 | Ole Miss | 4–1 | 9.509485 |
| 21 | Utah | 5–0 | 9.482154 |
| 22 | Oregon | 3–2 | 9.361795 |
| 23 | Florida | 4–2 | 9.320012 |
| 24 | Houston | 5–1 | 9.202525 |
| 25 | UTSA | 5–1 | 9.095118 |

Full field: [CSV](./week-06-rankings.csv). [Every snapshot audit](./audit.json). [Math, normalization and limits](../../../docs/METHODOLOGY.md).

The audit reconstructs each edge, record, rank, component mean, spring force and energy from the published heights. The full-precision stopping tolerance is 1e-10; rounding to six decimals introduces a small auditable residual. `npm run verify` separately recomputes the exact serialized files from raw input.
