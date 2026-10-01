# Backtest: choosing the method

How the ranking methods compare, and how to check it yourself. The published ranking (2026 onward) is **wins only** (Win Springs): it agrees with the most results. Gridiron Springs is the best margin-based option and remains available in the engine.

## Reproduce it

```sh
npm run backtest -- --history 2015-2025   # ~1 minute
npm run backtest                          # the seasons in data/seasons
```

`--history` downloads public, season-complete schedules from the [sportsdataverse cfbfastR-data](https://github.com/sportsdataverse/cfbfastR-data) project (the same CollegeFootballData game ids, scores and neutral-site flags) into a temp folder. Nothing it downloads is published or committed. Every method runs through this repository's engine (`src/engine`), so the published method is exactly the one tested.

## Protocol

- **Games:** completed FBS and FCS games, both teams in FBS/FCS, no ties. 2020 is skipped (conferences played very different, shortened schedules).
- **Predicting next week:** for every week *w* ≥ 4 of a season, fit each method on that season's games **before** week *w* only (no earlier seasons, no preseason information), then predict the winner of each week-*w* game between teams already seen. Home field is added for methods that fit it. Postseason counts as one final week. 11,593 games were predicted.
- **Agreeing with results:** fit each method on the whole season and count the share of all games where the winner is rated above the loser. For a ranking meant to replace a poll, this measures how well it respects what actually happened on the field.

The two measures pull in opposite directions: win/loss-only methods respect results best but predict worst; pure margin methods predict best but rank more winners below the teams they beat.

## Results (2015–2025)

| Method | Picks next week's winner | Final ranking agrees with results | Home field (avg) |
|---|---|---|---|
| **Wins only (Win Springs, published)** | 67.6% | **83.6%** | — |
| Margin as spring stiffness | 68.3% | 81.1% | — |
| Least squares on margin + home (Massey) | 71.6% | 80.2% | 2.27 pts |
| Sports-Reference SRS (margin clamped 7–24) | 70.2% | 81.7% | — |
| Gridiron, no blowout limit | 71.7% | 81.6% | 2.94 pts |
| Gridiron Springs | 71.2% | 81.9% | 3.01 pts |

### What each Gridiron piece contributes

These come from the same harness while exploring (not all rows are in the script's default list):

- **Win bonus.** Each spring wants the winner `margin + c` points above the loser. Only the ratio of bonus to margin matters for the order, so this one setting spans pure margin (c = 0) to win/loss only (c → ∞):

  | Win bonus c | Picks winner | Agrees with results |
  |---|---|---|
  | 0 (Massey) | 71.6% | 80.2% |
  | ~5 | 71.8% | 81.2% |
  | **7 (one touchdown)** | **71.7%** | **81.6%** |
  | 14 | 71.1% | 82.3% |
  | 21 | 70.7% | 82.6% |
  | ∞ (win/loss) | 67.6% | 83.6% |

  A touchdown is the largest bonus that costs no predictive accuracy.
- **Blowout limit.** Bounding how hard a game can pull once it is 21 points beyond expectation costs about half a point of prediction and gains a little agreement. It is there for fairness (running up the score can't buy rank), not accuracy. Plain caps on raw margin (21, 24, 28 points) did worse on prediction than the limit, because a cap also drags down strong teams that beat weak ones by more than the cap.
- **Home field.** Fitting it jointly is worth about +0.9 points of prediction over ignoring it. The plain least-squares fit (2.3 points on average) matches published estimates for modern college football (roughly 1.5–2.6). With the win bonus the fitted value reads higher (about 3.0), because it also absorbs part of the bonus in home wins.
- **Recency weighting** (newer games pull harder) changed prediction by at most +0.2 points and was left out: every game counts the same.
- **Stronger shrinkage** (α = 0.3 to 3, a stronger pull toward average) lowered prediction, so α stays tiny (0.01).

## Caveats

- One protocol, ten seasons. Differences of a few tenths of a percent are within noise; the big gaps (win/loss vs margin methods) are not.
- No preseason information is used, so early-week predictions are weak for every method. Systems that use priors (SP+, FPI) predict better early on, by design; we exclude priors to avoid bias.
- The historical data comes from a third-party mirror of CollegeFootballData. Small differences from the live API (corrections, neutral-site flags) would shift the numbers slightly.

## Sources

- Kenneth Massey, *Statistical Models Applied to the Rating of Sports Teams* (1997): https://masseyratings.com/theory/massey97.pdf
- Massey Ratings description (game outcome function, diminishing returns, rating vs power): https://masseyratings.com/theory/massey.htm
- Sports-Reference college football SRS (margin capped at 24, wins at least +7): https://www.sports-reference.com/cfb/about/glossary.html
- NCAA SRS report to the FCS committee (margin capped at 21): https://ncaaorg.s3.amazonaws.com/championships/sports/football/d1/2022-23D1MFB_SRSFinalReport.pdf
- Sagarin's diminishing returns on margin: https://en.wikipedia.org/wiki/Jeff_Sagarin
- ESPN FPI vs Strength of Record (predictive vs résumé): https://www.espn.com/blog/statsinfo/post/_/id/96761/determining-the-most-deserving-teams
- SP+ (garbage time, opponent adjustment): https://www.espn.com/college-football/story/_/id/49868647/2026-college-football-sp+-rankings-all-138-fbs-teams
- Home advantage in American football, a survey: https://arxiv.org/pdf/2401.16392
- Barrow et al., *Ranking rankings* (score-differential methods predict better): https://www.degruyterbrill.com/document/doi/10.1515/jqas-2013-0013/html
- Logan, *Whoa, Nellie!* (AP voters penalise early losses, ignore opponent strength in defeats): https://www.nber.org/papers/w13596
- BCS removing margin of victory (2002): https://www.cbssports.com/college-football/news/sagarin-changes-formula-finally-removes-margin-of-victory/
- SpringRank: https://www.science.org/doi/10.1126/sciadv.aar8260
