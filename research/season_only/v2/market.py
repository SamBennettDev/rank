"""Strict point-in-time quote ingestion and same-cutoff sportsbook consensus.

No quote is a model feature. Retrospective un-timestamped lines remain a separate
benchmark in the first study. Unknown capture times are rejected here.
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from common import INPUT,OUT
from prepare import download,digest,ROOT

REV='4cd9934927a9510ca534a540a0a2eebcec7408e6'
REPO='gmalbert/college-football-predictions'
URL=f'https://raw.githubusercontent.com/{REPO}/{REV}/data_files/processed/line_snapshots.parquet'
GAMES_URL=f'https://raw.githubusercontent.com/{REPO}/{REV}/data_files/processed/games.parquet'
REQUIRED=['game_id','sportsbook','market','side','captured_at','available_at','observed_at','line','odds','source','raw_payload_path','capture_method','is_live']

def load_quotes():
    paths=[INPUT/'timestamped_quotes.csv.gz',INPUT/'imported_quotes.csv.gz']
    frames=[pd.read_csv(path) for path in paths if path.exists()]
    if not frames:raise ValueError('No timestamped quote archive has been imported')
    return validate(pd.concat(frames,ignore_index=True))

def utc(series):return pd.to_datetime(series,utc=True,errors='coerce',format='mixed')

def validate(frame):
    missing=set(REQUIRED)-set(frame)
    if missing:raise ValueError(f'Missing quote columns: {sorted(missing)}')
    d=frame.copy()
    if d.sportsbook.isna().any() or d.source.isna().any():raise ValueError('Quote source and sportsbook identities are required')
    d['sportsbook']=d.sportsbook.astype(str).str.lower().str.replace(r'[^a-z0-9]','',regex=True)
    if d.sportsbook.eq('').any():raise ValueError('Missing sportsbook identity')
    for col in ['captured_at','available_at','observed_at']:
        if not isinstance(d[col].dtype,pd.DatetimeTZDtype):
            explicit=d[col].map(lambda v:pd.notna(v) and (getattr(v,'tzinfo',None) is not None or bool(re.search(r'(Z|UTC|[+-]\d{2}:?\d{2})$',str(v)))))
            if not explicit.all():raise ValueError(f'{col} requires an explicit timezone')
        d[col]=utc(d[col])
    if d[['captured_at','available_at','observed_at']].isna().any().any():
        raise ValueError('Every quote requires capture, observation, and availability timestamps')
    if (~d.side.isin(['home','away'])|~d.market.isin(['moneyline','spread'])).any():raise ValueError('Unknown market or side')
    if (d.available_at<d.captured_at).any():raise ValueError('A quote cannot be available before its capture')
    if (d.observed_at>d.available_at).any():raise ValueError('Observation is after quote availability')
    if d.raw_payload_path.fillna('').eq('').any():raise ValueError('Every quote requires raw provenance')
    if d.capture_method.isin(['inferred','retrospective_unknown','synthetic']).any():raise ValueError('Inferred quote timestamps are not eligible')
    if d.capture_method.isna().any():raise ValueError('Quote capture method is required')
    if not d.is_live.isin([True,False]).all():raise ValueError('Quote live status must be explicit')
    if (d.market.eq('moneyline')&~d.odds.abs().ge(100)).any():raise ValueError('Invalid American moneyline')
    if (d.market.eq('spread')&d.line.isna()).any():raise ValueError('Missing spread')
    return d

def consensus(frame,game_id,cutoff,max_age_hours=24,market='moneyline'):
    """Pair sides from one exact capture and book; then select last eligible pair."""
    cut=pd.Timestamp(cutoff,unit='s',tz='UTC') if isinstance(cutoff,(float,int,np.floating)) else pd.Timestamp(cutoff)
    d=frame[frame.game_id.eq(game_id)&frame.market.eq(market)].copy()
    if d.empty:return None
    for col in ['captured_at','available_at','observed_at']:d[col]=utc(d[col])
    eligible=(d.available_at<=cut)&(d.captured_at<=cut)&(d.observed_at<=cut)&d.is_live.eq(False)
    eligible&=(cut-d.observed_at).dt.total_seconds().between(0,max_age_hours*3600)
    d=d[eligible]
    keys=['game_id','sportsbook','source','captured_at']
    # Duplicate conflicting observations are not silently medianed into an invented pair.
    d=d.drop_duplicates(keys+['side','line','odds'])
    counts=d.groupby(keys+['side'],dropna=False).size()
    ambiguous=counts[counts>1].reset_index()[keys].drop_duplicates()
    if len(ambiguous):
        d=d.merge(ambiguous.assign(ambiguous=True),on=keys,how='left');d=d[~d.ambiguous.fillna(False)]
    h=d[d.side.eq('home')];a=d[d.side.eq('away')]
    paired=h.merge(a,on=keys,suffixes=('_h','_a'),validate='one_to_one')
    if paired.empty:return None
    # One sportsbook gets one vote even when multiple data vendors carry it.
    paired=paired.sort_values('captured_at').groupby('sportsbook',sort=False).tail(1)
    if market=='moneyline':
        implied=lambda z:np.where(z<0,-z/(100-z),100/(100+z))
        ph=implied(paired.odds_h);pa=implied(paired.odds_a);values=ph/(ph+pa)
    else:
        paired=paired[(paired.line_h+paired.line_a).abs()<1e-8]
        if paired.empty:return None
        values=-paired.line_h.to_numpy()
    return dict(value=float(np.median(values)),books=int(paired.sportsbook.nunique()),
        newest_capture=paired.captured_at.max().isoformat(),oldest_observation=paired[['observed_at_h','observed_at_a']].min().min().isoformat(),
        newest_availability=paired[['available_at_h','available_at_a']].max().max().isoformat(),
        max_age_hours=max_age_hours)

def public_archive():
    raw=Path('/tmp/rank-season-only/line_snapshots.parquet');games_raw=Path('/tmp/rank-season-only/market_games.parquet')
    download(URL,raw);download(GAMES_URL,games_raw)
    src=pq.read_table(raw).to_pandas();g=pq.read_table(games_raw).to_pandas()
    d=src[src.market.isin(['moneyline','spread'])&src.side.isin(['home','away'])&src.raw_payload_path.notna()&src.ingestion_run_id.notna()].copy()
    d=d[~d.topped_up.eq(True)&~d.is_live.eq(True)]
    index=json.loads((INPUT/'market_raw_index.json').read_text())
    if index['revision']!=REV:raise ValueError('Raw capture index does not match the pinned source revision')
    known={r['path'] for r in index['files']}
    referenced=d.raw_payload_path.astype(str).str.replace('\\','/',regex=False)
    missing_paths=sorted(set(referenced)-known)
    unresolved_rows=int((~referenced.isin(known)).sum())
    d=d[referenced.isin(known)].copy()
    # Date embedded in the immutable raw-capture filename is independent of later
    # normalized ingestion time. Never treat re-ingestion as a fresh observation.
    stamp=d.raw_payload_path.astype(str).str.extract(r'(\d{8}T\d{12}Z)_',expand=False)
    raw_time=pd.to_datetime(stamp,format='%Y%m%dT%H%M%S%fZ',utc=True,errors='coerce')
    d['observed_at']=utc(d.provider_observed_at).fillna(raw_time)
    d['captured_at']=utc(d.captured_at)
    d['available_at']=pd.concat([utc(d.available_at),d.captured_at,raw_time],axis=1).max(axis=1)
    d['capture_method']='public_immutable_capture';d['is_live']=False
    good=d.observed_at.notna()&d.available_at.notna()&d.captured_at.notna()&(d.observed_at<=d.available_at)
    good&=(d.market.eq('moneyline')&d.odds.abs().ge(100))|(d.market.eq('spread')&d.line.notna())
    d=d[good].copy()
    local=pd.read_csv(ROOT/'data/seasons/2026/games.csv')
    # Resolve source orientation against the same game's actual two participants.
    def team_name(value):
        value=''.join(c for c in unicodedata.normalize('NFKD',str(value)) if not unicodedata.combining(c))
        value=re.sub('[^a-z0-9]','',value.lower())
        return {'massachusetts':'umass','appalachianstate':'appstate','connecticut':'uconn',
                'southerncalifornia':'usc','mississippi':'olemiss','miamifl':'miami','louisianalafayette':'louisiana'}.get(value,value)
    orientation=g[['game_id','home_team','away_team']].drop_duplicates('game_id').rename(columns={'home_team':'quote_home','away_team':'quote_away'})
    orientation=orientation.merge(local[['id','home_team','away_team','start_date']],left_on='game_id',right_on='id')
    qh=orientation.quote_home.map(team_name);qa=orientation.quote_away.map(team_name)
    ch=orientation.home_team.map(team_name);ca=orientation.away_team.map(team_name)
    normal=qh.eq(ch)&qa.eq(ca);reverse=qh.eq(ca)&qa.eq(ch)
    unresolved=int((~(normal|reverse)).sum())
    orientation['reverse']=reverse;orientation=orientation[normal|reverse]
    d=d.merge(orientation[['game_id','reverse','start_date']],on='game_id',validate='many_to_one')
    d=d[d.captured_at<utc(d.start_date)]
    d.loc[d.reverse,'side']=d.loc[d.reverse,'side'].map({'home':'away','away':'home'})
    out=validate(d[REQUIRED]).sort_values(['captured_at','game_id','sportsbook','market','side'])
    path=INPUT/'timestamped_quotes.csv.gz';out.to_csv(path,index=False,compression=dict(method='gzip',mtime=0))
    (OUT/'market-sources.json').write_text(json.dumps(dict(repository=REPO,revision=REV,url=URL,raw_sha256=digest(raw),games_url=GAMES_URL,
        games_sha256=digest(games_raw),output_sha256=digest(path),source_rows=len(src),eligible_rows=len(out),games=int(out.game_id.nunique()),
        quote_side_reversals=int(reverse.sum()),unresolved_participant_games=unresolved,
        missing_raw_paths=missing_paths,unresolved_raw_path_rows=unresolved_rows,
        raw_index_sha256=digest(INPUT/'market_raw_index.json'),
        interpretation='Public third-party immutable capture archive; timestamps are source assertions, not independently audited bookmaker clocks. No historical capture is invented. Captures must precede canonical kickoff; inferred top-ups are excluded.'),indent=2)+'\n')
    print('Timestamped archive:',len(out),'rows,',out.game_id.nunique(),'games',flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path);parser.add_argument('--public',action='store_true')
    args=parser.parse_args()
    if args.public:public_archive();return
    if args.input is None:parser.error('Supply --public or a canonical --input CSV')
    d=validate(pd.read_csv(args.input));path=INPUT/'imported_quotes.csv.gz'
    d.to_csv(path,index=False,compression=dict(method='gzip',mtime=0));print('Validated quote import:',len(d))

if __name__=='__main__':main()
