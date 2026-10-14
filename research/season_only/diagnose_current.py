"""Audit published neural inputs and refit features after leaving out a game.

No training, data refresh, or production ranking changes. Run from the repo:
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/season_only/diagnose_current.py
"""
import argparse
import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from data import LAG, load
from graph_build import graph_features
from features import NAMES

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def diagnose(year=2026, snapshot_id='week-06'):
    directory = ROOT / f'data/seasons/{year}'
    bundle_path = directory / 'neural.json'
    bundle = json.loads(bundle_path.read_text())
    published = json.loads((ROOT / f'data/rankings/{year}/{snapshot_id}.json').read_text())
    snap = next(s for s in bundle['snapshots'] if s['id'] == snapshot_id)
    for name in ['teams', 'games', 'plays', 'rich']:
        assert digest(directory / f'{name}.csv') == bundle['source'][name + 'Sha256']
    assert max(bundle['trainingYears']) < year
    assert len({t['id'] for t in published['teams']}) == len(published['teams'])
    assert len({t['school'] for t in published['teams']}) == len(published['teams'])
    spec = importlib.util.spec_from_file_location('export_neural', ROOT / 'scripts/export-neural.py')
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    season = load(year)
    assert season.ids.tolist() == bundle['teamIds']
    rich = pd.read_csv(directory / 'rich.csv')
    indices = np.flatnonzero(season.games.game_id.isin(snap['gameIds']))
    assert set(season.games.iloc[indices].game_id) == set(snap['gameIds'])
    assert np.all(season.games.iloc[indices].time + LAG <= pd.Timestamp(snap['asOf']).timestamp())
    features = graph_features(season, indices, rich)
    np.testing.assert_allclose(features, snap['features'], atol=1e-10, rtol=0)
    n = season.n
    home, away = np.repeat(np.arange(n), n), np.tile(np.arange(n), n)

    def predict(x):
        return exporter.probability(bundle['groups'], x, home, away, np.zeros(n * n)).reshape(n, n)

    baseline = predict(features)
    np.testing.assert_allclose(baseline + baseline.T, 1, atol=1e-12, rtol=0)
    by_id = {t['id']: t for t in published['teams']}
    eligible = [i for i, tid in enumerate(season.ids) if by_id[tid]['rank'] is not None]
    fbs = [i for i, tid in enumerate(season.ids) if by_id[tid]['classification'] == 'fbs']
    top25 = [i for i, tid in enumerate(season.ids) if by_id[tid]['rank'] is not None and by_id[tid]['rank'] <= 25]
    cases = [dict(label='all-included-games', matrix=baseline.tolist(), eligible=eligible)]
    records = []
    for tid in [154, 204, 2483]:
        t = int(np.flatnonzero(season.ids == tid)[0])
        games = season.games.iloc[indices]
        games = games[(games.home == tid) | (games.away == tid)]
        mean = baseline.mean(axis=1)
        game_rows = []
        for game in games.itertuples():
            other = int(game.a if game.home == tid else game.h)
            game_rows.append(dict(gameId=int(game.game_id), home=game.home_team, away=game.away_team,
                homePoints=int(game.home_points), awayPoints=int(game.away_points),
                opponentCurrentRank=by_id[season.ids[other]]['rank']))
        comparisons = []
        signals = [(NAMES[j], features[:, j]) for j in [0, 1, 2, 3, 4, 5, 6]]
        signals += [('score_offense_plus_defense', features[:, 7] + features[:, 8]),
                    ('epa_offense_plus_defense', features[:, 9] + features[:, 10]),
                    ('success_offense_plus_defense', features[:, 11] + features[:, 12])]
        for name, value in signals:
            comparisons.append(dict(method=name, rank=int(1 + np.sum(value[eligible] > value[t]))))
        row = dict(teamId=tid, team=season.names[t], publishedRank=by_id[tid]['rank'],
            wins=by_id[tid]['wins'], losses=by_id[tid]['losses'],
            averageProbability=float(mean[t]), averageProbabilityRank=int(1 + np.sum(mean[eligible] > mean[t])),
            averageFbsProbability=float(baseline[t, fbs].mean()),
            averageOtherTop25Probability=float(baseline[t, [j for j in top25 if j != t]].mean()),
            componentAverages=by_id[tid]['neural'], games=game_rows, simplerMethods=comparisons,
            leaveOneGameOut=[])
        # All Wake results; the largest win for each Oregon school.
        chosen = games if tid == 154 else games.loc[[max(games.index, key=lambda j: (season.games.loc[j, 'margin'] if season.games.loc[j, 'home'] == tid else -season.games.loc[j, 'margin']))]]
        for game in chosen.itertuples():
            subset = indices[season.games.iloc[indices].game_id.to_numpy() != game.game_id]
            changed = graph_features(season, subset, rich)
            matrix = predict(changed)
            counts = np.bincount(season.games.iloc[subset].h, minlength=n) + np.bincount(season.games.iloc[subset].a, minlength=n)
            available = [i for i in eligible if counts[i] > 0]
            averages = matrix.mean(axis=1)
            label = f'{tid}-without-{game.game_id}'
            cases.append(dict(label=label, matrix=matrix.tolist(), eligible=available))
            row['leaveOneGameOut'].append(dict(case=label, gameId=int(game.game_id),
                averageProbability=float(averages[t]),
                averageProbabilityRank=int(1 + np.sum(averages[available] > averages[t])),
                probabilityChange=float(averages[t] - mean[t])))
            print(f'Refit {season.names[t]} without game {game.game_id}', flush=True)
        records.append(row)

    # Use the production ordering itself rather than a second implementation.
    with tempfile.TemporaryDirectory(prefix='rank-neural-diagnosis-') as temp:
        path = Path(temp)
        (path / 'cases.json').write_text(json.dumps(dict(ids=season.ids.tolist(), cases=cases)))
        (path / 'order.ts').write_text('import {readFileSync} from "node:fs";\n'
            + 'import {consensusOrder} from ' + json.dumps(str(ROOT / 'src/engine/neural.ts')) + ';\n'
            + 'const x=JSON.parse(readFileSync(process.argv[2],"utf8"));\n'
            + 'console.log(JSON.stringify(x.cases.map(c=>({label:c.label,ranks:consensusOrder(c.matrix.map(r=>Float64Array.from(r)),x.ids,c.eligible).ranks}))));\n')
        orders = json.loads(subprocess.check_output([str(ROOT / 'node_modules/.bin/tsx'),
            str(path / 'order.ts'), str(path / 'cases.json')], text=True, cwd=ROOT))
    ranks = {o['label']: o['ranks'] for o in orders}
    for t in eligible:
        assert ranks['all-included-games'][t] == by_id[season.ids[t]]['rank']
        assert abs(baseline[t].mean() - by_id[season.ids[t]]['neural']['roundRobinWinProbability']) < 0.00000051
    for row in records:
        t = int(np.flatnonzero(season.ids == row['teamId'])[0])
        for removed in row['leaveOneGameOut']:
            removed['consensusRank'] = ranks[removed['case']][t]
    report = dict(year=year, snapshot=snapshot_id, asOf=snap['asOf'],
        bundleSha256=digest(bundle_path), sourceHashes=bundle['source'],
        diagnosticCodeSha256=digest(Path(__file__)),
        checks=dict(uniqueTeamIds=True, uniqueSchoolNames=True, featuresReproduce=True,
            publishedScoresReproduce=True, publishedConsensusRanksReproduce=True,
            historicalWeightsOnly=True, cutoffRespected=True),
        interpretation='Leave-one-game-out refits every team feature and the full ordering with the same frozen weights. These are sensitivity scenarios, not confidence intervals, feature importance, or evidence of better future accuracy. Opponent ranks are current model outputs, not independent validation.',
        selection='Every Wake Forest game and the largest margin win for Oregon State and Oregon.', teams=records)
    output = ROOT / f'research/season_only/production/{year}-{snapshot_id}-diagnosis.json'
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, default=2026, choices=[2026])
    parser.add_argument('--snapshot', default='week-06')
    args = parser.parse_args()
    diagnose(args.year, args.snapshot)
