# Previous neural method (v1 archive)

Rank publishes a **neural ranking of who is more likely to beat whom**, with game forecasts from the same model. This section specifies `season-only-neural-1` / `season-only-neural-v1`. The older earned-credit method below remains available for archived audit and projections.

## Neural probabilities and pairwise ordering

The saved 2026 model uses shared weights trained on 2006–2025 pregame examples and outcome labels. Team inputs reset each season. Three rich-stat matchup networks receive 64 numeric features and have eight hidden neurons; three graph matchup networks receive 152 features and have 16 hidden neurons. The probability blend, selected on 2018–2019, is **75% rich / 25% graph**. Annual normalization and temperature calibration are saved with the weights.

The numeric features cover current-season score margins, capped/robust margins, results, opponent-adjusted offense/defense, EPA and success rates, passing/rushing, disruption, drives, evidence and recent games. Graph inputs add mean opponent and two-hop statistics. Neural inputs exclude team/player identities, conferences, divisions, recruiting, polls, preseason ratings and live betting prices. Names and IDs only join records. Every unplayed team has the same zero numeric inputs.

For standardized/clipped team vectors h and a, matchup networks process `[h−a, (h+a)/2]` and its reversal. Half the score difference gives an antisymmetric neutral logit; a learned venue coefficient supplies home advantage. Seed logits average within each network group before saved temperature calibration and sigmoid. The final probability averages the two calibrated group probabilities at weights .75/.25. Swapping teams and reversing venue complements the probability. Equal numeric inputs yield a neutral probability of .5.

```text
P[i,j] = neural probability that team i beats team j at a neutral venue
initial score[i] = mean_j P[i,j]
ordering objective = sum over all upper/lower pairs P[upper,lower]
```

Start with expected round-robin wins. Evaluate all insertion moves and apply the best improving move repeatedly until no improving insertion remains. Numeric IDs only resolve equal optimization choices and display order; identical probability profiles retain competition-rank ties. This is a deterministic local optimum of a weighted tournament objective, not an exact global Kemeny solution. Matchup cycles can leave some lower-ranked teams favored against higher-ranked ones. `manifest.neural` records initial/final objective, improving moves and remaining disagreeing pairwise favorites; these are ordering diagnostics, not game-prediction accuracy.

The displayed average win chance is the mean neutral probability against all modeled FBS/FCS teams, including a .5 self matchup. It summarizes the network, while the consensus determines rank; a team can have a slightly lower mean and still be placed higher by head-to-head evidence. Division/conference UI filters preserve full-field ranks. Teams without counted results remain unranked, although forecasts can use equal zero inputs with an evidence flag.

Scheduled-game probabilities and the arbitrary-team comparison tool use the same saved networks, with neutral/home/away venue as appropriate. Current features stay fixed at the selected snapshot; a future fixture’s result is never used. There are no hand-assigned penalties or ranking overrides for particular teams.

## Export, inference and reproducibility

`scripts/export-neural.py` reads local season games, teams, play-by-play and rich summaries. `scripts/neural-snapshots.ts` supplies the production calendar cutoffs and included game IDs. The exporter recomputes every numeric feature from only those included completed games; six hours after kickoff is the assumed result-availability time. It never retrains the networks. Weights for the forecast year must already exist and must be trained only on earlier years.

The portable `neural.json` includes model weights, normalization, training years, numeric feature names, all dated team matrices, included game IDs and source hashes. `neural-parity.json` contains independently computed Python probabilities and round-robin summaries for checking the TypeScript port. Rich summaries and their public-source provenance are published beside the bundle. The automatic data-update workflow refreshes these artifacts after fetching current results and plays. For a manual refresh:

```sh
python -m pip install -r scripts/requirements-neural.txt
REFRESH=1 npm run fetch-plays -- 2026
npm run neural:export -- --year 2026 --refresh-rich
npm run compute
npm run verify
```

The shared Node/browser inference module factors the matchup layer into reusable team projections, then evaluates pairwise hidden activations with fixed-arithmetic exponentials. Python parity is checked across every current team and snapshot, including neutral and venue-reversed cases. The engine rejects bundles whose team, game, play-by-play or rich-summary hashes differ, whose model year is wrong, or whose snapshot cutoffs/game IDs differ. The comparison tool also checks the bundle hash against the displayed ranking.

`rank-engine-18` retains schema 2 with explicit neural metadata. `rank`, `tied` and `change` refer to the consensus order. Neural `height` is an ordinal coordinate `field size + 1 − rank` for graph layout; actual probabilities live in `team.neural` and `predictions[].homeProbability`. Neural predictions have `strengthEdge: null` because the old points-scale edge does not apply. `lossPenalty` is null. The old score remains in `earnedHeight` / `earnedRank`; `credits` is its ledger. `projection.target = frozen-earned-points` identifies the retained old simulation target and does not forecast neural rank.

Missing play-by-play features shrink/fall back as specified by the saved feature functions. Fewer than three games, disconnected schedules or incomplete play coverage flag limited evidence. Neural estimates remain uncertain, especially early. The saved blend achieved 70.86% winner accuracy on 3,603 dated FBS games from 2020–2025; these are inspected development seasons, not a pristine holdout. No general market edge is established. The historical research tables use the original average-probability order; the production consensus ordering is a separate deterministic transformation of the same probabilities.


Current method: [METHODOLOGY.md](METHODOLOGY.md).
