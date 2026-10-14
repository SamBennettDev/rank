# 2026 raw one-sided spring graph

Through Week 6, cutoff 2026-10-11T08:30:00.000Z. 812 completed non-tied games connect 266 published FBS/FCS teams and 52 supporting opponents.

Every game has equal weight and a desired winner–loser gap of one unit. Minimize half the sum of squared positive shortfalls. All nodes start at zero; simultaneous spring forces settle the graph. Every connected group is then centered at zero. Score margin, site, historical seasons, neural weights and division priors are unused.

215 springs remain compressed: 42 winners are below their losers and 14 are level (1e-6 display tolerance). Cycles cannot all be satisfied. Equal published heights share a competition rank.

This is a results-constraint ranking. It does not supply calibrated probabilities or establish an accuracy advantage over a neural model or betting market. Slack springs can admit multiple equilibria; the documented zero-start relaxation fixes a reproducible solution. Disconnected groups cannot be compared from games alone. Long chains can create large heights, and no extra win reward applies once a spring is slack.

| Rank | Team | Record | Height |
| --- | --- | --- | --- |
| T-1 | Georgia | 6–0 | 18.420045 |
| T-1 | Miami | 5–0 | 18.420045 |
| T-3 | UCLA | 5–0 | 17.420045 |
| T-3 | Notre Dame | 6–0 | 17.420045 |
| T-3 | Wake Forest | 5–1 | 17.420045 |
| T-3 | Alabama | 5–1 | 17.420045 |
| T-7 | Mississippi State | 4–1 | 16.420045 |
| T-7 | Purdue | 3–3 | 16.420045 |
| T-9 | Kentucky | 5–1 | 15.420045 |
| T-9 | Minnesota | 4–2 | 15.420045 |
| T-11 | Michigan | 3–2 | 14.420045 |
| T-11 | Missouri | 5–1 | 14.420045 |
| T-11 | Ohio State | 5–1 | 14.420045 |
| T-11 | Oklahoma | 3–2 | 14.420045 |
| T-11 | Texas | 4–1 | 14.420045 |
| T-11 | Iowa | 5–1 | 14.420045 |
| T-11 | South Carolina | 3–3 | 14.420045 |
| T-18 | Florida | 4–2 | 13.420045 |
| T-18 | Tennessee | 5–1 | 13.420045 |
| T-20 | Auburn | 3–2 | 12.420045 |
| T-20 | Indiana | 6–0 | 12.420045 |
| T-22 | Northwestern | 4–1 | 11.420045 |
| T-22 | Baylor | 4–1 | 11.420045 |
| T-22 | Texas Tech | 5–0 | 11.420045 |
| 25 | Ole Miss | 4–1 | 11.023719 |

Full field: [CSV](./week-06-rankings.csv). [Every snapshot audit](./audit.json). [Math, normalization and limits](../../../docs/METHODOLOGY.md).

The audit reconstructs each edge, record, rank, component mean, spring force and energy from the published heights. The full-precision stopping tolerance is 1e-10; rounding to six decimals introduces a small auditable residual. `npm run verify` separately recomputes the exact serialized files from raw input.
