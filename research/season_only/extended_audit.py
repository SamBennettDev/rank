"""Export every additional neural candidate; later-result comparisons are exploratory."""
import json
import numpy as np
import pandas as pd
from scipy.special import expit
from neural import Network
from rich_build import RICH_CACHE
from graph_build import GRAPH_CACHE
from train import primary
from evaluate import metrics
from build import CACHE, OUT

def main():
    years = list(range(2020, 2026))
    meta = pd.concat([pd.read_csv(CACHE / f'{y}.csv') for y in years], ignore_index=True)
    mask = primary(meta).to_numpy()
    meta = meta[mask].reset_index(drop=True)
    odds = pd.read_csv(OUT / 'predictions.csv.gz', low_memory=False)
    odds = odds[primary(odds) & odds.year.between(2020, 2025)].reset_index(drop=True)
    assert np.array_equal(meta.game_id, odds.game_id)
    data = {}
    current = np.load(CACHE / '2026.npz'); n = len(current['team_ids'])
    for name, directory in [('rich', RICH_CACHE), ('graph', GRAPH_CACHE)]:
        data[name] = {k: np.concatenate([np.load(directory / f'{y}.npz')[k] for y in years])[mask]
                      for k in ['xh', 'xa']}
        data[name]['current'] = np.load(directory / '2026.npz')['snapshot_x']
    stats, ranks = [], []
    v = meta.venue.to_numpy()
    for family, directory, default in [('rich', 'rich-networks', 'rich'), ('graph', 'graph-networks', 'graph'),
                                        ('market_distilled', 'teacher-networks', 'rich')]:
        for path in sorted((OUT / directory).glob('*.json'), key=lambda p: int(p.stem)):
            d = json.loads(path.read_text()); feature = d['settings'].get('feature_set', default)
            nets = [Network.fromdict(m) for m in d['models']]; x = data[feature]
            z = np.mean([m.logits(x['xh'], x['xa'], v) for m in nets], axis=0)
            p = expit(z * d['temperature'])
            name = f'{family}:{path.stem}'
            item = dict(name=name, settings=d['settings'], validation=d['validation'],
                        exploratory_development=metrics(meta.y, p), matched={})
            for market in ['moneyline_market', 'spread_market']:
                good = odds['p_' + market].notna()
                item['matched'][market] = dict(model=metrics(meta.y[good], p[good]),
                                               benchmark=metrics(meta.y[good], odds.loc[good, 'p_' + market]))
            stats.append(item)
            xx = x['current']; h = np.repeat(xx, n, axis=0); a = np.tile(xx, (n, 1))
            z = np.mean([m.logits(h, a, np.zeros(n*n)) for m in nets], axis=0)
            strength = expit(z * d['temperature']).reshape(n, n).mean(1)
            eligible = np.flatnonzero(current['fbs']); order = eligible[np.argsort(-strength[eligible], kind='stable')]
            for pos, i in enumerate(order, 1):
                ranks.append(dict(method=name, rank=pos, team_id=int(current['team_ids'][i]),
                                  team=str(current['team_names'][i]), score=float(strength[i])))
        print('Audited', family, flush=True)
    (OUT / 'all-extended-neural-development.json').write_text(json.dumps(stats, indent=2) + '\n')
    pd.DataFrame(ranks).to_csv(OUT / 'week6-all-extended-neural-configurations.csv', index=False, float_format='%.10f')

if __name__ == '__main__': main()
