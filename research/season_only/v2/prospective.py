"""Issue immutable forward forecasts and grade only subsequently observed games.

This command does not schedule jobs, fetch private data, or place bets. It freezes
the selected weights, input hashes, prediction cohort, and benchmark at issuance.
"""
import argparse
import hashlib
import json
import shutil
import gzip
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
import pandas as pd
from common import INPUT,OUT,PARENT,HERE
from prepare import ROOT,digest
from model import load_model,predict
from forecast import selected_feature,snapshot,events,matchup,probability,v1_probability
from market import validate as validate_quotes,consensus,load_quotes
from evaluate import metrics

def issue():
    path=OUT/'prospective-registration.json'
    if path.exists():
        print('Registration already exists; refusing to replace an issued forecast. Use the existing registered cohort.');return path
    issued=datetime.now(timezone.utc);issued_s=issued.timestamp();feature=selected_feature()
    model_path=OUT/'models'/f'{feature}_2026.json.gz';obj=load_model(model_path)
    s,cut,tr,players,data=snapshot(2026,6)
    raw=pd.read_csv(ROOT/'data/seasons/2026/games.csv');raw['time']=pd.to_datetime(raw.start_date,utc=True,format='mixed').map(lambda t:t.timestamp())
    index={int(t):i for i,t in enumerate(s.ids)}
    future=raw[raw.time.gt(issued_s+3600)&raw.home_id.isin(index)&raw.away_id.isin(index)].copy()
    future=future[~future.completed.astype(str).str.lower().eq('true')]
    if future.empty:raise ValueError('No genuinely future fixtures to register')
    h=future.home_id.map(index).to_numpy();a=future.away_id.map(index).to_numpy();venue=(~future.neutral_site.astype(bool)).astype(float).to_numpy()
    p=probability(obj,data[feature],h,a,venue,data['v1_graph'])
    v1=v1_probability(data['v1_graph'],h,a,venue)
    q=load_quotes();report=events()
    rows=[]
    for j,r in enumerate(future.itertuples()):
        # Numeric team statistics stay frozen at Week 6; reports are separately
        # bounded at issuance, and never use a later report from the import file.
        m=matchup(obj,s,data[feature],tr,players,issued_s,h[j],a[j],bool(r.neutral_site),int(r.id),availability_events=report,baseline_graph=data['v1_graph'])
        quote=consensus(q,int(r.id),issued_s,24,'moneyline')
        rows.append(dict(game_id=int(r.id),home_id=int(r.home_id),away_id=int(r.away_id),home=r.home_team,away=r.away_team,
            scheduled_start=r.start_date,issued_at=issued.isoformat(),features_as_of=pd.Timestamp(cut,unit='s',tz='UTC').isoformat(),
            p_home=m['probability'],p_home_without_availability=float(p[j]),p_v1_home=float(v1[j]),moneyline_p=quote['value'] if quote else None,
            quote_newest_capture=quote['newest_capture'] if quote else None))
    registration=dict(protocol='Frozen Week 6 tail: weights and statistical snapshot fixed, availability and quotes at issuance. Only games starting >1 hour after issuance are eligible.',
        issued_at=issued.isoformat(),feature_set=feature,primary_metric='winner_accuracy',secondary_metrics=['brier','log_loss'],
        cohort='All registered FBS-vs-FBS games; compare V2 and frozen V1 on the same games. Market comparison uses identical games with both-side quotes <= issuance and <=24-hour age.',
        no_optional_stopping='Grade all registered eligible games at the end of the season. Interim summaries are descriptive only.',
        model_sha256=digest(model_path),selection_sha256=digest(OUT/'selection.json'),blend_selection_sha256=digest(OUT/'blend-selection.json'),protocol_sha256=digest(OUT/'protocol.json'),
        input_sha256={str(p.relative_to(ROOT)):digest(p) for p in [ROOT/'data/seasons/2026/games.csv',ROOT/'data/seasons/2026/plays.csv',
            ROOT/'data/seasons/2026/teams.csv',PARENT/'inputs/rich_2026.csv',INPUT/'context_2026.csv',INPUT/'players_2026.csv',
            INPUT/'availability_events.csv',INPUT/'timestamped_quotes.csv.gz',INPUT/'imported_quotes.csv.gz',INPUT/'imported_availability.csv'] if p.exists()},
        code_sha256={p.name:digest(p) for p in [HERE/'model.py',HERE/'forecast.py',HERE/'availability.py',HERE/'market.py']},
        fbs_team_ids=sorted(int(t) for t in s.ids[s.fbs]),forecasts=rows)
    portable=OUT/'prospective-feature-snapshot.npz'
    np.savez_compressed(portable,x=data[feature],baseline_graph=data['v1_graph'],team_ids=s.ids,team_names=np.asarray(s.names),fbs=s.fbs)
    shutil.copyfile(model_path,OUT/'prospective-model.json.gz')
    baseline={name:json.loads((PARENT/'results'/folder/'2026.json').read_text()) for name,folder in [('rich','rich-rolling-models'),('graph','graph-rolling-models')]}
    with gzip.open(OUT/'prospective-v1-models.json.gz','wt') as f:json.dump(baseline,f,separators=(',',':'))
    registration['baseline_model_sha256']=digest(OUT/'prospective-v1-models.json.gz')
    registration['feature_snapshot_sha256']=digest(portable)
    # Exclusive creation makes accidental re-issuance or silent overwrite fail.
    with path.open('x') as f:json.dump(registration,f,indent=2);f.write('\n')
    pd.DataFrame(rows).to_csv(OUT/'prospective-forecasts.csv',index=False,float_format='%.10f')
    print('Registered',len(rows),'genuinely future games;',sum(r['moneyline_p'] is not None for r in rows),'with timely paired moneylines',flush=True)
    return path

def grade(scores_path):
    lock=json.loads((OUT/'prospective-registration.json').read_text());forecasts=pd.DataFrame(lock['forecasts'])
    benchmark_addendum=OUT/'prospective-market-addendum.json'
    if benchmark_addendum.exists():
        correction=json.loads(benchmark_addendum.read_text())
        if correction['registration_sha256']!=digest(OUT/'prospective-registration.json'):raise ValueError('Benchmark correction belongs to a different registration')
        corrected={r['game_id']:r['corrected_probability'] for r in correction['quotes']}
        forecasts['moneyline_p']=forecasts.game_id.map(corrected)
    scores=pd.read_csv(scores_path)
    required={'game_id','home_id','away_id','home_points','away_points','completed','observed_at','actual_start','source_url'}
    if not required.issubset(scores):raise ValueError('Scores require '+', '.join(sorted(required)))
    if scores.game_id.duplicated().any():raise ValueError('Duplicate score records')
    s=forecasts.merge(scores,on='game_id',suffixes=('','_score'),validate='one_to_one')
    s=s[s.completed.astype(str).str.lower().eq('true')&s.home_points.notna()&s.away_points.notna()]
    for col in ['actual_start','observed_at']:
        import re
        if not s[col].map(lambda x:pd.notna(x) and bool(re.search(r'(Z|UTC|[+-]\d{2}:?\d{2})$',str(x)))).all():
            raise ValueError('Score timestamps require explicit offsets and cannot be missing')
    for col in ['home_points','away_points']:
        s[col]=pd.to_numeric(s[col],errors='raise')
        if (~np.isfinite(s[col])|s[col].lt(0)|s[col].ne(np.floor(s[col]))).any():raise ValueError('Invalid final score')
    issued=pd.to_datetime(s.issued_at,utc=True,format='mixed');kick=pd.to_datetime(s.actual_start,utc=True,format='mixed');observed=pd.to_datetime(s.observed_at,utc=True,format='mixed')
    now=pd.Timestamp(datetime.now(timezone.utc))
    if (observed>now).any():raise ValueError('A final score cannot be observed in the future')
    if (kick<=issued).any():raise ValueError('A rescheduled game actually started before forecast issuance')
    if (observed<kick+pd.Timedelta(hours=6)).any():raise ValueError('Score observation precedes the completion allowance')
    if (s.home_id.ne(s.home_id_score)|s.away_id.ne(s.away_id_score)).any():raise ValueError('Score participant orientation changed; reconcile it explicitly')
    if s.source_url.fillna('').eq('').any():raise ValueError('Every score needs provenance')
    fbs=set(lock['fbs_team_ids']);s=s[s.home_id.isin(fbs)&s.away_id.isin(fbs)&s.home_points.ne(s.away_points)]
    if s.empty:raise ValueError('No eligible completed registered FBS games')
    expected=int((forecasts.home_id.isin(fbs)&forecasts.away_id.isin(fbs)).sum())
    y=s.home_points.gt(s.away_points).astype(float);result=dict(status='interim descriptive' if len(s)<expected else 'complete',
        graded_at=now.isoformat(),grader_code_sha256=digest(Path(__file__)),games=len(s),registered_games=len(forecasts),registered_fbs_games=expected,model=metrics(y,s.p_home),registration_sha256=digest(OUT/'prospective-registration.json'),scores_sha256=digest(scores_path))
    if benchmark_addendum.exists():result['benchmark_addendum_sha256']=digest(benchmark_addendum)
    if 'p_v1_home' in s:result['v1_baseline']=metrics(y,s.p_v1_home)
    matched=s.moneyline_p.notna()
    if matched.any():result['matched_market']=dict(model=metrics(y[matched],s.p_home[matched]),market=metrics(y[matched],s.moneyline_p[matched]))
    (OUT/'prospective-grading.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('issue');g=sub.add_parser('grade');g.add_argument('--scores',type=Path,required=True);args=parser.parse_args()
    if args.command=='issue':issue()
    else:grade(args.scores)
