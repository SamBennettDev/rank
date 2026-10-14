# Why Wake Forest is #9, and why two Oregon schools appear

Audit of the neural development branch, using games through the **2026 Week 6 cutoff, October 11 at 08:30 UTC**. This report diagnoses the published model; it does not retrain it or change the rankings.

## Findings

**There are no duplicate teams in the saved standings.** Oregon State is #18 (ID 204, 4–2, Pac-12); Oregon is #20 (ID 2483, 3–2, Big Ten). They have different team records, game histories, links and logo URLs. Browser checks at widths 1280, 390 and 320 pixels show both full names without truncation. All 266 published IDs and school names are unique. A second row literally named “Oregon” was not reproduced.

**Wake Forest’s top-25 inclusion is plausible; its #9 placement is an aggressive neural estimate.** Wake is 5–1. Official school reports confirm its [57–3 Stanford win](https://godeacs.com/news/2026/10/3/football-wake-forest-records-largest-of-margin-of-victory-in-an-acc-game-defeats-stanford-57-3) and [38–14 road win at NC State](https://godeacs.com/news/2026/10/10/football-second-half-surge-sparks-demon-deacons-to-38-14-win-over-big-four-rival-nc-state). The [AP poll following those completed games ranks Wake #21](https://www.ncaa.com/news/football/article/2026-10-11/georgia-rises-no-1-lsu-and-oregon-fall-latest-ap-top-25-college-football-rankings). That poll is an external comparison, not a training input or ground truth for predictive strength.

## What is lifting Wake Forest?

Both neural groups are bullish: the rich-stat networks assign Wake an 89.18% average neutral win probability against the full FBS/FCS field; the opponent-graph networks assign 90.50%. Their 75/25 blend gives 89.51%, the eighth-highest average. The head-to-head consensus ordering places Wake ninth. Sorting therefore does not explain the elevation.

Wake’s numeric inputs include the best opponent-adjusted explosive-play prevention estimate in the 266-team field, the fifth-best rush-yards defense estimate and the seventh-best rush-EPA defense estimate. These are small-sample fitted statistics, not proof of nationally elite defense or a causal attribution of the network’s output. Passing efficiency and the two recent decisive wins also supply favorable evidence.

The simpler methods disagree about how strong that evidence is:

| Current-season method | Wake Forest rank |
| --- | ---: |
| Neural head-to-head consensus | 9 |
| Adjusted EPA offense plus defense | 14 |
| Bradley–Terry | 16 |
| Colley | 17 |
| Schedule-adjusted score margin | 20 |
| Capped score margin | 25 |
| Robust score margin | 25 |
| Margin-weighted Elo | 26 |
| Adjusted success-rate offense plus defense | 33 |

There is also limited evidence from wins against strong opponents. Among Wake’s five beaten opponents, Louisville has the best current neural rank, #37. Its only game against a currently ranked top-25 opponent was the 20–33 loss to #2 Miami. Those opponent ranks come from this same model and are not independent validation.

The displayed 89.51% is an average over all 266 teams, including FCS opponents and a 50% self-match. Against the 138 FBS teams, Wake’s average is 81.62%; against the other 24 current top-25 teams it is 53.42%. **89.51% is not a probability that Wake deserves rank #9, nor its chance against an arbitrary top-25 team.**

## Refitting after excluding one game

Each scenario removes the score and play statistics for the specified game, refits every team’s numeric features and opponent graph, recomputes all neural pair probabilities with unchanged weights, and reruns the production consensus ordering. This measures sensitivity, not accuracy or a confidence interval.

| Team | Excluded game | Published rank | Recomputed rank |
| --- | --- | ---: | ---: |
| Wake Forest | 38–16 win over Akron | 9 | 6 |
| Wake Forest | 38–36 win at Purdue | 9 | 8 |
| Wake Forest | 20–33 loss to Miami | 9 | 9 |
| Wake Forest | 30–27 win at Louisville | 9 | 11 |
| Wake Forest | 57–3 win over Stanford | 9 | 13 |
| Wake Forest | 38–14 win at NC State | 9 | 13 |
| Oregon State | 66–14 win over San Diego State | 18 | 25 |
| Oregon | 84–0 win over Portland State | 20 | 31 |

Wake stays in the top 25 in every single-game exclusion. Oregon’s top-25 inclusion is more sensitive to its largest blowout. Excluding a game also changes sample size and opponents’ fitted strength; the rank changes cannot be attributed solely to its scoring margin. No game should be discarded from the real standings on this basis.

## Where the model may be too optimistic

Six games leave substantial uncertainty. A neural network can amplify a combination of correlated efficiency and margin estimates that simpler methods rate more cautiously. These checks establish that the model computes #9 from the intended inputs; they do not establish that #9 is well calibrated. Future outcomes and historical tests of comparable cases are needed to distinguish an informative disagreement from overestimation. The previously reported historical comparisons also have not established a general advantage over betting markets.

The next candidate improvement is to validate stronger small-sample shrinkage, less sensitivity to extreme margins, and uncertainty estimates across **all** teams and historical early-season cutoffs. Select those settings using dated future-game performance before replacing the active model. Moving Wake to a preferred rank would not demonstrate an improvement.

## Reproduction

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/diagnose_current.py
```

Uses only saved local public-source data and frozen models. [Machine-readable results](2026-week-06-diagnosis.json) include source hashes, scores, opponent results, simpler-method comparisons and all exclusion scenarios. The script checks source hashes and chronology, reproduces the complete feature matrix, reproduces every published neural score and consensus rank, verifies complementary probabilities, and rejects duplicate school names or IDs. Historical training is permitted; every team’s evidence still resets for the current season.
