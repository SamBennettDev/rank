"""Price-free inference from saved historical weights and current-season statistics."""
import argparse
import json
import numpy as np
import pandas as pd
from data import load, week6, LAG
from features import features
from graph_build import graph_features
from rich_evaluate import model_probability
from graph_evaluate import probability as graph_probability
from teacher_evaluate import probability as teacher_probability
from rolling import predict as basic_probability
from prepare import INPUT
from build import OUT

MODELS = ['recommended', 'basic', 'rich', 'graph', 'market_distilled']

def snapshot(year=2026, week=6):
    s = load(year)
    if week == 6:
        cutoff, tr, _ = week6(s)
    else:
        through = s.games.season_type.eq('regular') & s.games.week.le(week)
        if not through.any():
            raise ValueError('No completed games at the requested week')
        cutoff = float((s.games.loc[through, 'time'] + LAG).max())
        tr = np.flatnonzero(through & (s.games.time + LAG <= cutoff))
    rich = pd.read_csv(INPUT / f'rich_{year}.csv')
    base = features(s, tr, {})
    graph = graph_features(s, tr, rich)
    return s, cutoff, {'basic': base, 'rich': graph[:, :64], 'graph': graph}

class Forecaster:
    """All prediction inputs are numeric snapshots; prices appear only in past training."""
    def __init__(self, year=2026):
        self.year = year
        self.models = {name: json.loads((OUT / directory / f'{year}.json').read_text())
            for name, directory in [('basic', 'rolling-models'), ('rich', 'rich-rolling-models'),
                                    ('graph', 'graph-rolling-models'), ('market_distilled', 'teacher-rolling-models')]}
        self.graph_alpha = json.loads((OUT / 'graph-blend-selection.json').read_text())['alpha']
        self.teacher_alpha = json.loads((OUT / 'teacher-blend-selection.json').read_text())['alpha']

    def probability(self, x, home, away, venue, model='recommended'):
        if model not in MODELS:
            raise ValueError(f'Unknown model: {model}')
        h, a = np.asarray(home, int), np.asarray(away, int)
        v = np.broadcast_to(np.asarray(venue, float), h.shape)
        def rich():
            return model_probability(self.models['rich'], x['rich'][h], x['rich'][a], v)
        def graph():
            return graph_probability(self.models['graph'], x['graph'][h], x['graph'][a], v)
        def teacher():
            key = self.models['market_distilled']['feature_set']
            return teacher_probability(self.models['market_distilled'], x[key][h], x[key][a], v)
        if model == 'basic':
            return basic_probability(self.models['basic'], x['basic'][h], x['basic'][a], v)[0]
        if model == 'rich': return rich()
        if model == 'graph': return graph()
        if model == 'market_distilled': return teacher()
        blend = self.graph_alpha * graph() + (1 - self.graph_alpha) * rich()
        if self.teacher_alpha:
            blend = self.teacher_alpha * teacher() + (1 - self.teacher_alpha) * blend
        return blend

    def ranking(self, s, x, field='fbs', model='recommended'):
        n = s.n
        p = self.probability(x, np.repeat(np.arange(n), n), np.tile(np.arange(n), n),
                             np.zeros(n*n), model).reshape(n, n)
        strength = p.mean(1)
        eligible = np.flatnonzero(s.fbs if field == 'fbs' else np.ones(n, bool))
        order = eligible[np.argsort(-strength[eligible], kind='stable')]
        return [dict(rank=i, team_id=int(s.ids[t]), team=s.names[t], score=float(strength[t]))
                for i, t in enumerate(order, 1)]

def remaining_schedule(year=2026, week=6):
    if year != 2026:
        raise ValueError('The saved future fixture list is available for 2026')
    s, cutoff, x = snapshot(year, week)
    from prepare import ROOT
    raw = pd.read_csv(ROOT / 'data/seasons/2026/games.csv')
    ix = {t: i for i, t in enumerate(s.ids)}
    times = pd.to_datetime(raw.start_date, utc=True)
    mask = (times.map(lambda t: t.timestamp()) >= cutoff) & raw.home_id.isin(ix) & raw.away_id.isin(ix)
    g = raw[mask].copy()
    model = Forecaster(year)
    p = model.probability(x, g.home_id.map(ix), g.away_id.map(ix), (~g.neutral_site.astype(bool)).astype(float))
    out = g[['id', 'week', 'start_date', 'home_id', 'away_id', 'home_team', 'away_team', 'neutral_site']].copy()
    out['home_win_probability'] = p
    out['predicted_winner'] = np.where(p >= .5, g.home_team, g.away_team)
    out['as_of'] = pd.Timestamp(cutoff, unit='s', tz='UTC').isoformat()
    out.to_csv(OUT / 'week6-2026-future-games.csv', index=False, float_format='%.10f')
    return out

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year', type=int, default=2026)
    parser.add_argument('--week', type=int, default=6)
    parser.add_argument('--model', choices=MODELS, default='recommended')
    parser.add_argument('--field', choices=['fbs', 'fbs_fcs'], default='fbs')
    parser.add_argument('--home'); parser.add_argument('--away')
    parser.add_argument('--neutral', action='store_true')
    parser.add_argument('--future', action='store_true', help='Export the known remaining 2026 schedule')
    args = parser.parse_args()
    if bool(args.home) != bool(args.away): parser.error('--home and --away must be supplied together')
    if args.future:
        if args.model != 'recommended': parser.error('--future uses the recommended blend')
        print(f'Exported {len(remaining_schedule(args.year, args.week))} future games')
        return
    s, cutoff, x = snapshot(args.year, args.week)
    model = Forecaster(args.year)
    result = dict(model=args.model, year=args.year, through_week=args.week,
                  as_of=pd.Timestamp(cutoff, unit='s', tz='UTC').isoformat())
    if args.home:
        lookup = {name.lower(): i for i, name in enumerate(s.names)}
        lookup.update({str(t): i for i, t in enumerate(s.ids)})
        try: h, a = lookup[args.home.lower()], lookup[args.away.lower()]
        except KeyError as e: parser.error(f'Unknown team: {e.args[0]}')
        p = float(model.probability(x, [h], [a], [0 if args.neutral else 1], args.model)[0])
        result.update(home=s.names[h], away=s.names[a], neutral=args.neutral, home_win_probability=p,
                      predicted_winner=s.names[h if p >= .5 else a])
    else:
        result.update(field=args.field, rankings=model.ranking(s, x, args.field, args.model))
    print(json.dumps(result, indent=2))

if __name__ == '__main__': main()
