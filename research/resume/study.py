"""Results-only resume study. No margin, identity, poll, or preseason inputs.

Calibration measures future winner probabilities; resume agreement is separately
reported as descriptive consistency, never as an objective fairness ground truth.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
INPUT = ROOT / 'research/season_only/inputs'
EPOCH = pd.Timestamp('1970-01-05T12:00:00Z').timestamp()
LAG = 21600


def round6(value):
    return float(np.floor(value*1e6+.5)/1e6)


def load(year):
    path = ROOT / 'data/seasons/2026/games.csv' if year == 2026 else INPUT / f'games_{year}.csv'
    g = pd.read_csv(path).rename(columns={'id': 'game_id'})
    if year == 2026:
        teams = pd.read_csv(ROOT / 'data/seasons/2026/teams.csv').sort_values('id')
        info = {int(t.id): (t.school, t.classification) for t in teams.itertuples()}
    else:
        info = {}
        for r in g.itertuples():
            for side in ['home', 'away']:
                if getattr(r, side + '_division') in ['fbs', 'fcs']:
                    info[int(getattr(r, side + '_id'))] = (getattr(r, side + '_team'), getattr(r, side + '_division'))
    ids = sorted(info)
    ix = {t: i for i, t in enumerate(ids)}
    g = g[g.completed.astype(str).str.lower().eq('true') & g.home_points.notna() & g.away_points.notna() & g.home_points.ne(g.away_points)].copy()
    g = g[g.home_id.isin(ix) | g.away_id.isin(ix)].copy()
    g['h'] = g.home_id.map(ix).fillna(-1).astype(int)
    g['a'] = g.away_id.map(ix).fillna(-1).astype(int)
    g['time'] = pd.to_datetime(g.start_date, utc=True).map(lambda t: t.timestamp())
    g['y'] = (g.home_points > g.away_points).astype(float)
    g['site'] = (~g.neutral_site.astype(bool)).astype(float)
    g['batch'] = EPOCH + np.floor((g.time - EPOCH) / 604800) * 604800
    g = g.sort_values(['game_id']).reset_index(drop=True)
    return dict(year=year, n=len(ids), ids=ids, names=[info[t][0] for t in ids],
                fbs=np.array([info[t][1] == 'fbs' for t in ids]), g=g,
                path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest())


def fit(n, g, ridge, home, exclude=-1, initial=None):
    g = g[(g.h >= 0) & (g.a >= 0) & (g.h != exclude) & (g.a != exclude)]
    h, a, y, site = [g[c].to_numpy() for c in ['h', 'a', 'y', 'site']]
    def objective(r):
        edge = r[h] - r[a] + home * site
        p = expit(edge)
        value = np.logaddexp(0, edge).sum() - y @ edge + .5 * ridge * (r @ r)
        gradient = ridge * r + np.bincount(h, p-y, n) - np.bincount(a, p-y, n)
        return value, gradient
    result = minimize(objective, np.zeros(n) if initial is None else initial.copy(), jac=True,
                      method='L-BFGS-B', options=dict(gtol=1e-9, ftol=1e-14, maxiter=200))
    if not result.success and np.max(np.abs(result.jac)) > 1e-5:
        raise RuntimeError(result.message)
    # L-BFGS can stop on function tolerance before the last decimal of a
    # published receipt is stable. Finish with sparse Newton solves.
    from scipy.sparse import coo_matrix, eye
    from scipy.sparse.linalg import spsolve
    r=result.x.copy()
    for _ in range(5):
        _,gradient=objective(r)
        if np.max(np.abs(gradient))<1e-11:break
        p=expit(r[h]-r[a]+home*site);w=p*(1-p)
        matrix=coo_matrix((np.r_[w,w,-w,-w],(np.r_[h,a,h,a],np.r_[h,a,a,h])),shape=(n,n)).tocsc()+ridge*eye(n,format='csc')
        r-=spsolve(matrix,gradient)
    return r


def metrics(y, p):
    p = np.clip(np.asarray(p), 1e-12, 1-1e-12)
    y = np.asarray(y)
    return dict(games=len(y), accuracy=float(np.mean(np.where(p == .5, .5, (p > .5) == y))),
                brier=float(np.mean((y-p)**2)), logLoss=float(np.mean(-y*np.log(p)-(1-y)*np.log1p(-p))))


def calibrate():
    seasons = [load(y) for y in range(2014, 2020)]
    candidates = []
    for ridge in [.125, .25, .5, 1.]:
        for home in [0., .15, .3, .45]:
            ys, ps = [], []
            for s in seasons:
                g = s['g']
                for cutoff in sorted(g.batch.unique()):
                    test = g[(g.batch == cutoff) & (g.week >= 4) & (g.h >= 0) & (g.a >= 0)]
                    test = test[s['fbs'][test.h] & s['fbs'][test.a]]
                    if test.empty:
                        continue
                    train = g[g.time + LAG <= cutoff]
                    r = fit(s['n'], train, ridge, home)
                    ps.extend(expit(r[test.h] - r[test.a] + home*test.site))
                    ys.extend(test.y)
            row = dict(ridge=ridge, homeAdvantage=home, **metrics(ys, ps))
            candidates.append(row)
            print(json.dumps(row), flush=True)
    selected = min(candidates, key=lambda r: (r['logLoss'], r['ridge'], r['homeAdvantage']))
    settings = dict(method='opponent-independent-resume-v1', ridge=selected['ridge'],
                    homeAdvantage=selected['homeAdvantage'], benchmarkRank=25,
                    reference='fbs', leaveTeamOut=True)
    report = dict(status='Design calibration; 2014-2019 already inspected in earlier research.',
                  selection='Minimum pooled future FBS game log loss from dated pre-week fits. Benchmark rank 25 and wins-above-benchmark are declared resume policies, not fitted labels.',
                  selected=settings, candidates=candidates,
                  inputs=[{k:s[k] for k in ['year','path','sha256']} for s in seasons])
    HERE.mkdir(exist_ok=True)
    (HERE / 'protocol.json').write_text(json.dumps(report, indent=2)+'\n')


def tail_probability(probabilities, wins):
    distribution = np.array([1.])
    for p in probabilities:
        distribution = np.convolve(distribution, [1-p, p])
    return float(distribution[int(wins):].sum())


def resumes(s, g, settings, receipts=False):
    n = s['n']
    ridge, home = settings['ridge'], settings['homeAdvantage']
    global_r = fit(n, g, ridge, home)
    rows = []
    for t in range(n):
        own = g[(g.h == t) | (g.a == t)]
        if own.empty:
            rows.append(None)
            continue
        r = fit(n, g, ridge, home, exclude=t, initial=global_r)
        reference = r[s['fbs'] & (np.arange(n) != t)]
        reference = np.sort(reference)[::-1]
        benchmark = float(reference[min(settings['benchmarkRank'], len(reference))-1])
        ps, values, games = [], [], []
        wins = 0
        for game in own.itertuples():
            is_home = game.h == t
            opponent = game.a if is_home else game.h
            won = bool(game.y) == is_home
            site = game.site * (1 if is_home else -1)
            # No quality can be established for supporting opponents absent from
            # the modeled field: no win credit and a full loss cost.
            p = float(expit(benchmark-r[opponent]+home*site)) if opponent >= 0 else 1.
            p = round6(p)
            value = round6(float(won)-p)
            ps.append(p)
            values.append(value)
            wins += won
            if receipts:
                other = g[(g.h >= 0) & (g.a >= 0) & ((g.h == opponent) | (g.a == opponent)) & (g.h != t) & (g.a != t)] if opponent >= 0 else g.iloc[:0]
                games.append(dict(gameId=int(game.game_id), opponentId=int(game.away_id if is_home else game.home_id),
                                  won=won, where=int(site), benchmarkWinProbability=p, value=value,
                                  opponentGames=len(other), unmodeled=opponent < 0))
        expected_micros=sum(int(np.floor(p*1e6+.5)) for p in ps)
        row = dict(score=(int(wins)*1000000-expected_micros)/1e6, expectedWins=expected_micros/1e6, wins=int(wins), losses=len(own)-wins,
                   recordProbability=round6(tail_probability(ps, wins)),
                   scheduleDifficulty=float(np.floor((len(ps)*1e6-expected_micros)/len(ps)+.5)/1e6),
                   benchmarkStrength=round6(benchmark))
        if receipts:
            row['games'] = games
        rows.append(row)
    return global_r, rows


def agreement(s, g, scores):
    h, a = g.h.to_numpy(), g.a.to_numpy()
    scores = np.round(scores, 6)
    w = np.where(g.y, h, a)
    l = np.where(g.y, a, h)
    correct = np.where(scores[w] > scores[l], 1., np.where(scores[w] == scores[l], .5, 0.))
    fbs = s['fbs'][h] & s['fbs'][a]
    return {name:dict(games=int(mask.sum()), correct=float(correct[mask].sum()), rate=float(correct[mask].mean()))
            for name, mask in [('all', np.ones(len(g), bool)), ('fbs', fbs)]}


def evaluate():
    protocol = json.loads((HERE/'protocol.json').read_text())
    settings = protocol['selected']
    records, inputs, predictions = [], [], []
    for year in range(2002, 2026):
        s = load(year)
        g = s['g']
        inputs.append({k:s[k] for k in ['year','path','sha256']})
        for cutoff in sorted(g.batch.unique()):
            test = g[(g.batch == cutoff) & (g.week >= 4) & (g.h >= 0) & (g.a >= 0)]
            test = test[s['fbs'][test.h] & s['fbs'][test.a]]
            if test.empty:
                continue
            train = g[g.time + LAG <= cutoff]
            r = fit(s['n'], train, settings['ridge'], settings['homeAdvantage'])
            p = expit(r[test.h]-r[test.a]+settings['homeAdvantage']*test.site)
            for game, probability in zip(test.itertuples(), p):
                predictions.append(dict(year=year, gameId=int(game.game_id), cutoff=cutoff,
                                        y=float(game.y), probability=float(probability)))
        through = g[(g.season_type == 'regular') & (g.week <= 6)]
        week6_cutoff = float((through.time + LAG).max())
        for snapshot, subset in [('week6', g[g.time+LAG <= week6_cutoff]), ('final', g)]:
            r, rows = resumes(s, subset, settings)
            modeled = subset[(subset.h >= 0) & (subset.a >= 0)]
            wins = np.zeros(s['n']); losses = wins.copy()
            for game in subset.itertuples():
                w,l = (game.h,game.a) if game.y else (game.a,game.h)
                if w >= 0: wins[w] += 1
                if l >= 0: losses[l] += 1
            from scipy.linalg import solve
            matrix = np.eye(s['n'])*2
            for game in modeled.itertuples():
                matrix[game.h,game.h] += 1; matrix[game.a,game.a] += 1
                matrix[game.h,game.a] -= 1; matrix[game.a,game.h] -= 1
            # Colley uses the same modeled cohort; external opponent wins/losses
            # are not injected into its matrix or right-hand side.
            mh,ma = modeled.h.to_numpy(),modeled.a.to_numpy()
            my = modeled.y.to_numpy()*2-1
            colley = solve(matrix, .5*(np.bincount(mh,my,s['n'])-np.bincount(ma,my,s['n'])), assume_a='pos')
            candidates = {
                'Wins above top-25 benchmark': np.array([x['score'] if x else np.nan for x in rows]),
                'Record difficulty (Poisson-binomial)': np.array([-x['recordProbability'] if x else np.nan for x in rows]),
                'Win percentage': wins/np.maximum(wins+losses,1),
                'Net wins': wins-losses, 'Colley': colley, 'Results-only Bradley-Terry': r}
            for method, scores in candidates.items():
                records.append(dict(year=year, snapshot=snapshot, method=method, agreement=agreement(s,modeled,scores)))
        print('evaluated',year,flush=True)
    pd.DataFrame(predictions).to_csv(HERE/'predictions.csv.gz', index=False)
    report = dict(status='Retrospective development; no untouched holdout. Same-game agreement is descriptive, not prediction accuracy or proof of resume fairness.',
                  protocolSha256=hashlib.sha256((HERE/'protocol.json').read_bytes()).hexdigest(), inputs=inputs,
                  settings=settings, standings=records,
                  predictionMetrics=metrics([p['y'] for p in predictions],[p['probability'] for p in predictions]))
    (HERE/'evaluation.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['calibrate','evaluate'])
    args=parser.parse_args()
    calibrate() if args.command == 'calibrate' else evaluate()
