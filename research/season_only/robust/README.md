# Robust neural model and stronger loss deductions

[Full report, historical comparisons and Week 6 rankings](REPORT.md).

The active model caps margins before every selected score-derived fit, bounds the total neural adjustment, shrinks performance at small sample sizes and applies a positive loss deduction after training. Rankings and venue-aware predictions use the same strength. Its historical accuracy is lower than the previous model; the report quantifies the policy tradeoff.

`results/` preserves the first study; `bounded-results/` preserves the second. The strict-cap third study is `capped-results/`; the active, numerically converged weights and final reports are in `polished-results/`. Their registered protocols, selections, validation probabilities and annual weights are saved. The protocols named `*-preflight.json` precede fixes to serialization or standalone import checks; no model fits or selection results preceded those fixes.

The original pinned Python requirements and derived historical caches are needed to retrain. `capped_features.py` rebuilds its derived caches, and `capped_study.py` implements selection, annual refitting and evaluation. `polish.py` continues unconverged selected fits on the identical objective, preserving already-converged weights, and refits older-fold calibration. `capped_calibrate.py` fits a positive probability-only temperature from older validation forecasts. `sensitivity.py` checks full-game exclusion and score-only counterfactuals. `report.py` writes the final comparison without selecting models. Production inference only needs the exported JSON; it does not need Python.

All seasons in these studies had already been inspected. Earlier years are hindcasts relative to later architecture selection. No general sportsbook advantage or independent prospective validation is claimed. Earlier prospective registrations remain intact.
