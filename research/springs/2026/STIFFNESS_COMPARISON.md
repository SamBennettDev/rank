# 2026 Week 6: five spring policies

All policies use exactly the same current-season games, seven-point target and full compression stiffness. They differ only in stretched-spring pull stiffness. Every variant is reconstructed from raw winner/loser endpoints; weights are frozen before the final fit.

| Policy | Georgia | Alabama | Reversed game edges | First five |
| --- | --- | --- | --- | --- |
| Exact two-way | 8 | 2 | 83 | Notre Dame, Alabama, UCLA, Texas, Miami |
| All stretched pulls at 25% | 2 | 1 | 75 | Alabama, Georgia, Notre Dame, UCLA, Miami |
| Opponent-strength pull | 5 | 1 | 80 | Alabama, Notre Dame, Miami, UCLA, Georgia |
| Best-win support | 1 | 2 | 75 | Georgia, Alabama, Miami, Notre Dame, UCLA |
| Best-win support, minimum 25% | 2 | 1 | 77 | Alabama, Georgia, Miami, Notre Dame, UCLA |

**Selected rule: best-win support.** If d is how much stronger a winner's best beaten opponent is than this beaten opponent, in the equal-spring reference graph, k = 2^(−max(0,d)/7). Strongest wins retain k = 1. Each seven-point difference halves downward pull stiffness. Compression retains k = 1 for every game, preserving full pressure when a winner is too low.

A flat 25% pull weakens attraction even on the strongest wins. Absolute opponent-strength weighting depends on the arbitrary zero of a disconnected component. The selected rule directly implements the requested protection when stronger wins exist, and depends only on within-component strength differences. It adds no floor parameter. The 25% floor variant is shown as a sensitivity check.

These are retrospective ranking-policy comparisons. The policies were inspected on these results; selection is a design judgment matching the request, not evidence of improved future-game accuracy. No neural training or market comparison was performed for these graph variants. The Georgia/Alabama order flips under the alternative 25% floor, so this remains a soft preference, not guaranteed head-to-head priority. Reversal counts cover all supplied games, including supporting opponents.

[Every policy's full rankings and game-force diagnosis](./stiffness-comparison.json). [Active full Week 6 ranking](./REPORT.md).
