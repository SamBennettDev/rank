"""Registered multi-period selection, annual refits, and matched evaluation."""
import argparse
import hashlib
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.special import expit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from build import CACHE
from graph_build import GRAPH_CACHE
from evaluate import metrics, paired
from rich_evaluate import model_probability
from graph_evaluate import probability as graph_probability
from robust.features import inputs, records, NAMES
from robust.network import RobustRanker, probability

OUT = HERE / 'results'
SEEDS = [7, 19, 43]
FOLDS = [(2014, [2014, 2015]), (2016, [2016, 2017]), (2018, [2018, 2019])]


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def settings():
    return [dict(width=w, ridge=r, evidence_prior=e, loss_penalty=l)
        for w in [8, 16] for r in [.01, .05] for e in [2., 6.] for l in [1., 2., 4.]]


def read(years, primary=True):
    metas, hs, aas = [], [], []
    for year in years:
        meta = pd.read_csv(CACHE / f'{year}.csv')
        raw = np.load(GRAPH_CACHE / f'{year}.npz')
        mask = (meta['mode'].eq('weekly') & meta.fbs).to_numpy() if primary else np.ones(len(meta), bool)
        metas.append(meta[mask]); hs.append(raw['xh'][mask]); aas.append(raw['xa'][mask])
    meta = pd.concat(metas, ignore_index=True)
    h, a = np.concatenate(hs), np.concatenate(aas)
    hg, hl = records(h); ag, al = records(a)
    return meta, dict(h=inputs(h), a=inputs(a), hg=hg, ag=ag, hl=hl, al=al), (h, a)


def fit(config, first_forecast_year, training=None):
    meta, x, _ = read(range(2006, first_forecast_year)) if training is None else training
    scale = np.maximum(np.std(np.r_[x['h'], x['a']], axis=0), .01)
    weight = 2 ** ((meta.year.to_numpy()-meta.year.max())/4)
    models = []
    for seed in SEEDS:
        model = RobustRanker(**config, seed=seed, scale=scale).fit(**x,
            venue=meta.venue.to_numpy(), y=meta.y.to_numpy(), weights=weight)
        models.append(model.asdict())
    return dict(year=first_forecast_year, training_years=list(range(2006, first_forecast_year)),
        training_games=len(meta), settings=config, models=models)


def score(meta, p):
    annual, early = [], []
    counts = np.minimum(records_from_metadata(meta, 'h'), records_from_metadata(meta, 'a')) if '_hg' in meta else None
    for year in sorted(meta.year.unique()):
        m = meta.year.eq(year).to_numpy()
        annual.append(metrics(meta.y[m], p[m])['accuracy'])
        e = m & (meta['_hg'].le(6) | meta['_ag'].le(6)).to_numpy()
        if e.any(): early.append(metrics(meta.y[e], p[e])['accuracy'])
    return dict(utility=float((np.mean(annual)+np.mean(early))/2),
        macro_accuracy=float(np.mean(annual)), macro_early_accuracy=float(np.mean(early)), pooled=metrics(meta.y, p))


def records_from_metadata(meta, side): return meta['_' + side + 'g'].to_numpy()


def baseline(forecast_year, raw, venue):
    old = HERE.parent / 'results'
    rich = json.loads((old / f'rich-rolling-models/{forecast_year}.json').read_text())
    graph = json.loads((old / f'graph-rolling-models/{forecast_year}.json').read_text())
    h, a = raw
    return .75*model_probability(rich, h[:, :64], a[:, :64], venue) + .25*graph_probability(graph, h, a, venue)


def register():
    OUT.mkdir(parents=True, exist_ok=True)
    protocol = dict(settings=settings(), folds=FOLDS, seeds=SEEDS, feature_names=NAMES,
        training_half_life=4, loss_prior=4, input_clip=4,
        selection='Maximize mean of macro-season overall and <=6-prior-game accuracy, then minimize pooled log loss. All candidates have positive loss deduction and positive evidence shrinkage. Do not select on 2020–2026 or individual current ranks.',
        evaluation='Annual prior-season-only refits 2007–2026. Report 2020–2025 development results, frozen Week 6, matched market/CFP, per-season metrics, and older hindcasts. All historical seasons were previously inspected; no untouched holdout claim.',
        source={str(p.relative_to(HERE)):digest(p) for p in [HERE/'features.py', HERE/'network.py', Path(__file__)]})
    path = OUT / 'protocol.json'
    if path.exists():
        assert json.loads(path.read_text()) == protocol, 'Registered protocol changed; explicitly version a new experiment.'
    else: path.write_text(json.dumps(protocol, indent=2)+'\n')


def trial(job):
    i, cfg = job
    all_meta, all_p, base_p = [], [], []
    for year, valyears in FOLDS:
        target, x, raw = read(valyears)
        target['_hg'], target['_ag'] = x['hg'], x['ag']
        checkpoint = OUT / 'validation-models' / f'{i}-{year}.json'
        if checkpoint.exists(): model = json.loads(checkpoint.read_text())
        else:
            model = fit(cfg, year)
            checkpoint.write_text(json.dumps(model, separators=(',', ':'))+'\n')
        p = probability(model, **x, venue=target.venue.to_numpy())
        all_meta.append(target); all_p.append(p)
        if i == 0: base_p.append(baseline(year, raw, target.venue.to_numpy()))
    meta = pd.concat(all_meta, ignore_index=True); p = np.concatenate(all_p)
    np.save(OUT / 'validation-models' / f'prediction-{i}.npy', p)
    if i == 0:
        meta.to_csv(OUT/'validation-games.csv', index=False)
        np.save(OUT/'validation-models/baseline.npy', np.concatenate(base_p))
    result = dict(index=i, settings=cfg, validation=score(meta, p))
    print('Robust validation', i, json.dumps(result['validation']), flush=True)
    return result


def select():
    register(); (OUT/'validation-models').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(trial, enumerate(settings())))
    chosen = min(results, key=lambda r: (-r['validation']['utility'], r['validation']['pooled']['log_loss']))
    meta = pd.read_csv(OUT/'validation-games.csv')
    base = np.load(OUT/'validation-models/baseline.npy')
    selection = dict(protocolSha256=digest(OUT/'protocol.json'), chosen=chosen,
        baseline=score(meta, base), design=results)
    (OUT/'selection.json').write_text(json.dumps(selection, indent=2)+'\n')
    print('SELECTED', json.dumps(chosen), flush=True)


def annual(year):
    selection = json.loads((OUT/'selection.json').read_text())
    model = fit(selection['chosen']['settings'], year)
    (OUT/'annual-models'/f'{year}.json').write_text(json.dumps(model, separators=(',', ':'))+'\n')
    meta, x, raw = read([year], primary=False)
    p = probability(model, **x, venue=meta.venue.to_numpy())
    np.save(OUT/f'annual-predictions/{year}.npy', p)
    print('Robust annual', year, len(model['training_years']), 'past seasons', flush=True)


def refit():
    (OUT/'annual-models').mkdir(exist_ok=True); (OUT/'annual-predictions').mkdir(exist_ok=True)
    with ProcessPoolExecutor(max_workers=3) as pool:
        list(pool.map(annual, range(2007, 2027)))


def evaluate():
    base = pd.read_csv(HERE.parent/'results/predictions.csv.gz', low_memory=False)
    previous = pd.read_csv(HERE.parent/'results/graph-predictions.csv.gz')
    assert base[['year','game_id','mode']].equals(previous[['year','game_id','mode']])
    pieces = []
    for year in range(2007, 2027):
        meta = pd.read_csv(CACHE/f'{year}.csv'); meta['p_robust'] = np.load(OUT/f'annual-predictions/{year}.npy')
        meta['_hg'], meta['_ag'] = read([year], primary=False)[1]['hg'], read([year], primary=False)[1]['ag']
        pieces.append(meta)
    pred = pd.concat(pieces, ignore_index=True)
    pred = pred.merge(base[['year','game_id','mode','p_moneyline_market','p_spread_market','p_massey','cfp_pick','cfp_both_ranked']], on=['year','game_id','mode'], validate='one_to_one')
    pred = pred.merge(previous[['year','game_id','mode','p_graph_ensemble']], on=['year','game_id','mode'], validate='one_to_one')
    report = dict(selectionSha256=digest(OUT/'selection.json'), overall={}, paired={}, seasons=[])
    for mode in ['weekly','frozen_week6']:
        mask = pred.year.between(2020,2025) & pred.fbs & pred['mode'].eq(mode)
        report['overall'][mode] = dict(robust=metrics(pred.y[mask],pred.p_robust[mask]), previous=metrics(pred.y[mask],pred.p_graph_ensemble[mask]))
        for benchmark in ['graph_ensemble','moneyline_market','spread_market','massey']:
            m = mask & pred['p_'+benchmark].notna()
            report['paired'][mode+':'+benchmark] = dict(model=metrics(pred.y[m],pred.p_robust[m]),benchmark=metrics(pred.y[m],pred['p_'+benchmark][m]),comparison=paired(pred.y[m],pred.p_robust[m],pred['p_'+benchmark][m],pred.year[m]))
    for year in range(2007,2026):
        for mode in ['weekly','frozen_week6']:
            m = pred.year.eq(year) & pred.fbs & pred['mode'].eq(mode)
            if not m.any():continue
            for col in ['robust','graph_ensemble','moneyline_market','spread_market','massey']:
                take = m & pred['p_'+col].notna()
                report['seasons'].append(dict(year=year,mode=mode,method=col,**metrics(pred.y[take],pred['p_'+col][take])))
    main=pred.year.between(2020,2025)&pred.fbs&pred['mode'].eq('weekly')
    early=main&(pred._hg.le(6)|pred._ag.le(6))
    report['early']=dict(robust=metrics(pred.y[early],pred.p_robust[early]),previous=metrics(pred.y[early],pred.p_graph_ensemble[early]))
    for both in [False,True]:
        m=main&pred.cfp_pick.notna()
        if both:m &= pred.cfp_both_ranked
        report['cfp_both' if both else 'cfp_any']=dict(games=int(m.sum()),robust=metrics(pred.y[m],pred.p_robust[m]),committee_accuracy=float(np.where(pred.cfp_pick[m]==.5,.5,pred.cfp_pick[m]==pred.y[m]).mean()))
    pred.to_csv(OUT/'predictions.csv.gz',index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    pd.DataFrame(report['seasons']).to_csv(OUT/'season-metrics.csv',index=False,float_format='%.10f')
    (OUT/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('ROBUST EVALUATION',json.dumps(report['overall']),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['register','select','refit','evaluate'])
    args=parser.parse_args();globals()[args.action]()
