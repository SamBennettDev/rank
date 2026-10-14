"""Generate the calibrated comparison and current rankings without model selection."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.special import expit,logit

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from prepare import ROOT
from evaluate import metrics,paired

OUT=HERE/'polished-results'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    calibration=json.loads((OUT/'calibration.json').read_text());temperature=calibration['temperature']
    pred=pd.read_csv(OUT/'predictions.csv.gz')
    pred['p_new']=expit(temperature*logit(np.clip(pred.p_bounded,1e-10,1-1e-10)))
    report=dict(temperature=temperature,selectionSha256=digest(OUT/'selection.json'),calibrationSha256=digest(OUT/'calibration.json'),overall={},paired={},seasons=[],cfp={})
    for mode in ['weekly','frozen_week6']:
        mask=pred.year.between(2020,2025)&pred.fbs&pred['mode'].eq(mode)
        report['overall'][mode]=dict(new=metrics(pred.y[mask],pred.p_new[mask]),previous=metrics(pred.y[mask],pred.p_graph_ensemble[mask]))
        for benchmark in ['graph_ensemble','moneyline_market','spread_market','massey']:
            m=mask&pred['p_'+benchmark].notna()
            report['paired'][mode+':'+benchmark]=dict(model=metrics(pred.y[m],pred.p_new[m]),benchmark=metrics(pred.y[m],pred['p_'+benchmark][m]),comparison=paired(pred.y[m],pred.p_new[m],pred['p_'+benchmark][m],pred.year[m]))
    for year in range(2007,2026):
        for mode in ['weekly','frozen_week6']:
            for name in ['new','graph_ensemble','moneyline_market','spread_market','massey']:
                mask=pred.year.eq(year)&pred.fbs&pred['mode'].eq(mode)&pred['p_'+name].notna()
                if mask.any():report['seasons'].append(dict(year=year,mode=mode,method=name,**metrics(pred.y[mask],pred['p_'+name][mask])))
    main=pred.year.between(2020,2025)&pred.fbs&pred['mode'].eq('weekly')
    early=main&(pred._hg.le(6)|pred._ag.le(6))
    report['early']=dict(new=metrics(pred.y[early],pred.p_new[early]),previous=metrics(pred.y[early],pred.p_graph_ensemble[early]))
    for both in [False,True]:
        mask=main&pred.cfp_pick.notna()
        if both:mask &= pred.cfp_both_ranked
        report['cfp']['both'if both else'any']=dict(games=int(mask.sum()),model=metrics(pred.y[mask],pred.p_new[mask]),committee_accuracy=float(np.where(pred.cfp_pick[mask]==.5,.5,pred.cfp_pick[mask]==pred.y[mask]).mean()))
    allpast=pred.year.between(2007,2025)&pred.fbs&pred['mode'].eq('weekly')
    report['allHistoricalHindcasts']=dict(new=metrics(pred.y[allpast],pred.p_new[allpast]),previous=metrics(pred.y[allpast],pred.p_graph_ensemble[allpast]))
    # The first study's reporter included zero-coverage market rows. Keep that
    # archive valid JSON without changing its model, selection or positive-count metrics.
    firstpath=HERE/'results/evaluation.json'
    first=json.loads(firstpath.read_text());empty=sum(r['games']==0 for r in first['seasons'])
    first['seasons']=[r for r in first['seasons']if r['games']>0]
    first['omittedEmptySeasonComparisons']=first.get('omittedEmptySeasonComparisons',0)+empty
    firstpath.write_text(json.dumps(first,indent=2,allow_nan=False)+'\n')
    (OUT/'calibrated-evaluation.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    pd.DataFrame(report['seasons']).to_csv(OUT/'calibrated-season-metrics.csv',index=False,float_format='%.10f')
    pred.to_csv(OUT/'calibrated-predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    ranking=json.loads((ROOT/'data/rankings/2026/week-06.json').read_text())
    ranked=sorted([t for t in ranking['teams']if t['rank']is not None],key=lambda t:(t['rank'],t['id']))
    rows=[dict(rank=t['rank'],team_id=t['id'],team=t['school'],wins=t['wins'],losses=t['losses'],average_neutral_probability=t['neural']['roundRobinWinProbability'],model_rank_low=t['neural']['modelRankRange']['low'],model_rank_high=t['neural']['modelRankRange']['high'])for t in ranked]
    pd.DataFrame(rows).to_csv(OUT/'2026-week-06-rankings.csv',index=False,float_format='%.10f')
    evaluation=report['overall']['weekly'];frozen=report['overall']['frozen_week6'];selection=json.loads((OUT/'selection.json').read_text())['chosen']
    policy=ranking['manifest']['neural']['policy'];sensitivity=json.loads((OUT/'sensitivity.json').read_text())
    pct=lambda x:f'{100*x:.2f}%'
    table='\n'.join(f'| {t["rank"]} | {t["school"]} | {t["wins"]}–{t["losses"]} |'for t in ranked[:25])
    pairs=[]
    for label,key in [('Previous neural blend','graph_ensemble'),('Spread favorites','spread_market'),('Moneyline favorites','moneyline_market'),('Adjusted margin','massey')]:
        r=report['paired']['weekly:'+key]
        pairs.append(f'| {label} | {r["model"]["games"]:,} | {pct(r["model"]["accuracy"])} | {pct(r["benchmark"]["accuracy"])} | {r["model"]["log_loss"]:.4f} / {r["benchmark"]["log_loss"]:.4f} |')
    stable=sensitivity['historical'];cur=[c for c in sensitivity['cases']if c['year']==2026]
    currenttable='\n'.join(f'| {c["team"]} | {c["home"]} {c["homePoints"]}–{c["awayPoints"]} {c["away"]} | {c["previousRank"]} → {c["previousExcludedRank"]} | {c["newRank"]} → {c["newExcludedRank"]} |'for c in cur if abs(c['homePoints']-c['awayPoints'])>=35)
    seasons=[]
    for year in range(2020,2026):
        mask=main&pred.year.eq(year)
        new=metrics(pred.y[mask],pred.p_new[mask]);old=metrics(pred.y[mask],pred.p_graph_ensemble[mask])
        seasons.append(f'| {year} | {new["games"]} | {pct(new["accuracy"])} | {pct(old["accuracy"])} |')
    content=f'''# Robust neural rankings with stronger loss consequences

The active model uses a robust schedule rating plus a **bounded neural correction**, shrinks performance estimates with limited current-season evidence, and deducts losses **after** performance training. A single neutral-field strength determines both rankings and matchup predictions. Team identity, previous-season team ratings, conference/division, recruiting, polls and live prices remain excluded.

This implements a more loss-sensitive ranking policy. It does **not** establish a predictive accuracy improvement: the new policy picks **{pct(evaluation['new']['accuracy'])}** of winners on 3,603 FBS games in 2020–2025, versus **{pct(evaluation['previous']['accuracy'])}** previously, an accuracy difference of {100*(evaluation["new"]["accuracy"]-evaluation["previous"]["accuracy"]):+.2f} percentage points. Probability calibration uses 2014–2019 forecasts only and cannot change picks or ranks.

## How it works

1. Cap every game margin to ±35 **before** fitting every selected score-derived rating, including Huber. Fit current-season ratings and opponent-adjusted efficiency. Increasing an already 35-point margin supplies zero extra scoreboard credit; actual play efficiency can still add evidence. Exclude raw scoring averages, uncapped margin, raw EPA averages, margin variation, Elo and record ratings from the neural correction. Opponent margin context uses capped ratings. Existing play summaries exclude garbage time.
2. Three shared neural fits use 50 numeric inputs and an eight-neuron hidden layer. Bound standardized inputs to ±4, and bound the **entire neural correction** to ±{policy['residualLimit']}. Add it to the robust margin rating divided by {policy['anchorScale']}.
3. Multiply performance strength by `n / (n + {policy['evidencePrior']})`, using completed games against modeled opponents. At six games, retain {100*6/(6+policy["evidencePrior"]):.0f}% of that estimate. At zero games, performance strength is exactly zero.
4. Deduct `{policy['lossPenalty']} × losses / (n + {policy['lossPrior']})` after fitting the performance network. All losses count, including losses to outside opponents. A loss never has a positive direct effect when performance inputs and n are held fixed. Opponent strength and performance still matter, so an actual loss does not guarantee a fixed number of lost ranking positions.
5. Predict with `sigmoid({temperature:.6f} × (strength A − strength B + learned venue effect))`. The positive temperature was selected on older validation forecasts. With six modeled games, one additional loss lowers calibrated log odds by {temperature*policy['lossPenalty']/(6+policy['lossPrior']):.4f}; a hypothetical 50% matchup becomes {pct(expit(-temperature*policy['lossPenalty']/(6+policy['lossPrior'])))} with other evidence held fixed.

The scalar architecture gives a consistent neutral order with no favorite cycles. Team pages show completed games, losses and evidence retained after shrinkage; that weight is not confidence in a rank. Downloaded data also contains rank spread across the three fits. That spread measures fit variation, **not** sampling uncertainty or a confidence interval. Limited-evidence flags remain visible; precise ranks still have uncertainty.

## Search and historical validation

The first study tested 24 designs across three older periods and three seeds: 216 neural fits. It applied loss deductions during training; the model could partly compensate through correlated performance features. It picked 70.30% in the later-season comparison and did not resolve the ranking concern.

The second study registered 16 bounded neural configurations, three validation periods and three seeds: 144 neural fits. Three positive **post-fit** loss penalties yielded 48 candidate policies. Selection used 2006–2013→2014–2015, 2006–2015→2016–2017 and 2006–2017→2018–2019, balancing macro-season overall and early-sample accuracy, then log loss. The final chosen settings are `{json.dumps(selection['settings'],sort_keys=True)}`, loss coefficient {selection['loss_penalty']}. A third registered study kept the same 16 configurations and three loss penalties, while imposing the 35-point cap before Huber and every other selected score-derived fit. It adds 144 neural fits. Three sets of 20 annual refits add 180 networks: **684 new neural fits in total**. The final settings above come from the structurally capped study. Verification then found 36 of 60 annual fits had reached the initial iteration budget; the nine selected validation fits and 36 unconverged annual fits were continued on the identical objective until numerical convergence; 24 already-converged annual fits were preserved. This made 45 optimizer continuations without changing architecture, features, loss settings or training cutoffs. Probability calibration was refitted on only the same older validation forecasts.

Every annual model trains only on earlier seasons. There are 19 completed historical prediction seasons, 2007–2025. Architecture and calibration use later years relative to the earliest hindcasts, so those early results are not a contemporaneous prospective test. The final design round followed inspection of earlier studies and both earlier rounds’ 2020–2025 results. **All historical comparisons are retrospective development evidence.** Neither selecting on older folds nor collecting many fits creates an untouched holdout.

| Comparison on identical dated weekly games | Games | New policy accuracy | Benchmark accuracy | Log loss: new / benchmark |
| --- | ---: | ---: | ---: | ---: |
{chr(10).join(pairs)}

For rankings frozen after Week 6 and used for the remaining season: **{pct(frozen['new']['accuracy'])}** versus **{pct(frozen['previous']['accuracy'])}** previously on {frozen['new']['games']:,} games. The new model’s frozen-snapshot log loss is {frozen['new']['log_loss']:.4f}, versus {frozen['previous']['log_loss']:.4f}. The [full comparison](polished-results/calibrated-evaluation.json) includes Brier scores, early samples, paired season-block bootstrap intervals, CFP matched games and all historical seasons. Archived spread prices do not have certified forecast-time capture timestamps; CFP lists are committee outputs, not a public prediction formula.

| Season | Weekly games | New policy | Previous neural blend |
| --- | ---: | ---: | ---: |
{chr(10).join(seasons)}

## Sensitivity checks

The audit excludes one complete game at a time and refits all features and opponent adjustments with unchanged annual neural weights. It tests eight largest FBS winning margins through Week 6 in each of 2020–2025, plus every 2026 game of Wake Forest, LSU, Oregon and Oregon State. Selection of the active model does not use these audit outcomes.

Across {stable['new']['absoluteRankChange']['cases']} historical extreme-win exclusions, mean absolute change in average-probability rank is **{stable['new']['absoluteRankChange']['mean']:.2f} places**, versus **{stable['previous']['absoluteRankChange']['mean']:.2f}** previously. Mean absolute full-field probability change is **{100*stable['new']['absoluteProbabilityChange']['mean']:.2f} points**, versus **{100*stable['previous']['absoluteProbabilityChange']['mean']:.2f}**. Full-game exclusions change the record, evidence count, and performance together. Their rank changes are not a pure blowout test, and stronger loss penalties can increase their sensitivity when a win disappears. Probability calibration also affects probability sensitivity; rank changes are invariant to calibration. These selected scenarios are not population accuracy evidence or confidence intervals. A separate score-only test changes margins above 35 to exactly 35 while holding the winner, sample size, venue, opponent and actual play summaries fixed. The entire new probability matrix remains unchanged to 1e-12 in every one of {len(sensitivity["scoreOnly"])} tested cases. This tests the score-feature path rather than a physically complete alternative game.

| Team | Excluded result | Previous average rank | New rank |
| --- | --- | ---: | ---: |
{currenttable}

Previous average-probability ranks may differ slightly from the previous consensus ordering. Full cases and direct loss counterfactuals are in [sensitivity.json](polished-results/sensitivity.json). Neither robustness nor the loss policy guarantees a preferred team’s position.

## 2026 Week 6 rankings

As of {ranking['snapshot']['asOf']}, through completed games. The full [ranking export](polished-results/2026-week-06-rankings.csv) includes every FBS/FCS team. Oregon State and Oregon retain distinct identities. Average probabilities use the full field; they are not probabilities that a rank is correct.

| Rank | Team | Record |
| ---: | --- | ---: |
{table}

## Reproduction

From the repository root, with the original pinned Python requirements and existing feature caches:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/bounded_study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_features.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py select
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py refit
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_study.py evaluate
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/capped_calibrate.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/polish.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python -c "import sys; sys.path.insert(0, 'research/season_only'); import robust.capped_study as study; from pathlib import Path; study.OUT=Path('research/season_only/robust/polished-results'); study.evaluate()"
npm run neural:export -- --year 2026
npm run compute
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/sensitivity.py
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/robust/report.py
python -m unittest discover -s research/season_only/robust -p test_robust.py -v
npm test
npm run verify
```

Registered protocols, selections, validation predictions and annual models are saved. Existing prospective registrations and forecasts from earlier studies remain unchanged; this model needs subsequent, separately identified prospective results for an independent test. Report code SHA-256: `{digest(Path(__file__))}`.
'''
    (HERE/'REPORT.md').write_text(content)
    print(json.dumps(report['overall']),flush=True)

if __name__=='__main__':main()
