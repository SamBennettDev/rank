"""Point-in-time availability events and production-based counterfactual inputs.

Unreported is unknown. Injury diagnoses are not inferred from nonparticipation.
Names/IDs resolve joins only; the network sees numeric current-season production.
"""
import argparse
import json
import re
from pathlib import Path
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from common import INPUT,OUT
from prepare import digest,download
from prepare_context import normalize_name

STATUSES={'available':0.,'probable':.1,'questionable':.5,'doubtful':.8,'out':1.,'opt_out':1.}
REQUIRED=['season','team_id','athlete_id','player_name','position','status','published_at','available_at',
          'effective_from','valid_until','game_id','source_url','time_precision']
TIMES=['published_at','available_at','effective_from','valid_until']

def validate(events):
    missing=set(REQUIRED)-set(events)
    if missing:raise ValueError(f'Missing availability columns: {sorted(missing)}')
    d=events.copy()
    if not d.status.isin(STATUSES).all():raise ValueError('Unknown availability status')
    for col in TIMES:
        if not isinstance(d[col].dtype,pd.DatetimeTZDtype):
            explicit=d[col].map(lambda v:pd.notna(v) and (getattr(v,'tzinfo',None) is not None or bool(re.search(r'(Z|UTC|[+-]\d{2}:?\d{2})$',str(v)))))
            if not explicit.all():raise ValueError(f'{col} requires an explicit timezone')
        d[col]=pd.to_datetime(d[col],utc=True,errors='coerce',format='mixed')
        if d[col].isna().any():raise ValueError(f'Availability requires {col}')
    if (d.available_at<d.published_at).any():raise ValueError('Availability predates publication')
    if (d.valid_until<=d.effective_from).any():raise ValueError('Availability interval is empty')
    if d.source_url.fillna('').eq('').any():raise ValueError('Availability needs a source')
    if (d.player_name.fillna('').eq('')&d.athlete_id.isna()).any():raise ValueError('Availability needs a player join')
    d['name_key']=d.player_name.map(normalize_name)
    return d

def at_cutoff(events,season,team_id,cutoff,game_id=None):
    cut=pd.Timestamp(cutoff,unit='s',tz='UTC') if isinstance(cutoff,(float,int,np.floating)) else pd.Timestamp(cutoff)
    d=events[events.season.eq(season)&events.team_id.eq(team_id)&events.available_at.le(cut)&events.published_at.le(cut)
             &events.effective_from.le(cut)&events.valid_until.gt(cut)].copy()
    if game_id is None:d=d[d.game_id.isna()]
    else:d=d[d.game_id.isna()|d.game_id.eq(game_id)]
    if d.empty:return d
    d['join_key']=np.where(d.athlete_id.notna(),'id:'+d.athlete_id.fillna(0).astype(int).astype(str),'name:'+d.name_key)
    return d.sort_values(['available_at','published_at']).groupby('join_key',sort=False).tail(1)

def resolve_player(report,players):
    """Exact ID or unique name match; ambiguous initials never force a join."""
    if pd.notna(report.athlete_id):
        ids=players[players.athlete_id.eq(report.athlete_id)].player_key.unique()
        if len(ids)==1:return ids[0]
        if len(ids)>1:return None
    names=players['name'].map(normalize_name)
    candidates=players.loc[names.eq(normalize_name(report.player_name)),'player_key'].unique()
    if len(candidates)==1:return candidates[0]
    return None

def adjust_profile(profile,games,players,reports,scenario='central'):
    """Modify expected production, not the team's observed score/EPA history.

    Central questionable probabilities are nominal scenario weights, not a fitted
    medical forecast. The lower/upper scenarios expose this uncertainty.
    """
    result=profile.copy();audit=[]
    if reports.empty:return result,audit
    loss={}
    for r in reports.itertuples():
        key=resolve_player(r,players)
        risk=STATUSES[r.status]
        if r.status in ['probable','questionable','doubtful']:
            risk=0. if scenario=='available' else 1. if scenario=='out' else risk
        audit.append(dict(player=r.player_name,status=r.status,matched=key is not None,
                          nominal_absence_probability=risk,source=r.source_url))
        if key is not None:loss[key]=risk
    if not loss or players.empty or games.empty:return result,audit
    recent_ids=games.sort_values(['time','game_id']).game_id.iloc[-2:]
    for role,start in [('qb',0),('rb',7),('wr',10)]:
        p=players[players.role.eq(role)]
        if p.empty:continue
        total=p.groupby('player_key').agg(uses=('uses','sum'),epa=('epa','sum'))
        recent=p[p.game_id.isin(recent_ids)].groupby('player_key').uses.sum()
        if recent.empty:continue
        baseline=recent/recent.sum()
        risk=pd.Series({key:loss.get(key,0.) for key in baseline.index})
        removed=float((baseline*risk).sum())
        if removed<=0:continue # Already absent from recent usage; no repeated penalty.
        remaining=baseline*(1-risk)
        if role=='qb':
            backup=total[~total.index.isin(baseline.index)]
            backup=backup[~backup.index.to_series().map(loss).fillna(0).ge(1).to_numpy()]
            if len(backup) and backup.uses.sum()>0:
                replacement=backup.uses/backup.uses.sum()*removed
                expected=remaining.add(replacement,fill_value=0)
            elif remaining.sum()>0:
                expected=remaining/remaining.sum()
            else:
                expected=remaining # Unknown replacement has zero centered EPA, not a fabricated identity prior.
            rates=total.epa/(total.uses+20)*60
            result[3]=float((rates.reindex(expected.index,fill_value=0)*expected).sum())
            result[1]=max(0,result[1]-removed)
            result[5]=max(result[5],removed)
        else:
            result[start+2]=max(result[start+2],removed)
    return result,audit

def adjust_features(x,feature_set,s,idx,players,events,cutoff,game_id=None,scenario='central'):
    """Availability is usable by feature sets containing player-production profiles."""
    result=x.copy();audit=[]
    if feature_set not in ['full','graph_context']:return result,audit
    base=64 if feature_set=='full' else 152;start=base+48
    past=s.games.iloc[idx];p=players[players.game_id.isin(past.game_id)]
    for i,team_id in enumerate(s.ids):
        reports=at_cutoff(events,s.year,int(team_id),cutoff,game_id)
        if reports.empty:continue
        own=past[(past.h==i)|(past.a==i)];pp=p[p.team_id.eq(team_id)]
        result[i,start:start+16],detail=adjust_profile(result[i,start:start+16],own,pp,reports,scenario)
        audit.extend([dict(team_id=int(team_id),**row) for row in detail])
    return result,audit

def public_snapshot_audit():
    raw=Path('/tmp/rank-season-only/injuries_2026.parquet')
    url='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_injuries/injuries_2026.parquet'
    download(url,raw);d=pq.read_table(raw).to_pandas()
    # Observation date is not a refreshed injury report. Reject stale prior-year notes.
    report=pd.to_datetime(d.injury_date,utc=True,errors='coerce')
    capture=pd.to_datetime(d.as_of_date,utc=True)+pd.Timedelta(days=1)
    fresh=report.ge(pd.Timestamp('2026-08-01T00:00:00Z'))&(report<=capture)&((capture-report).dt.days<=30)
    (OUT/'availability-source-audit.json').write_text(json.dumps(dict(url=url,raw_sha256=digest(raw),rows=len(d),
        fresh_current_season_rows=int(fresh.sum()),rejected_stale_or_undated=int((~fresh).sum()),
        rule='Snapshot date alone does not refresh an old injury note. Unknown absence of a report is not healthy.',
        coverage='Curated published announcements are a small, nonrepresentative pilot; full historical conference reports are not available in this input archive.'),indent=2)+'\n')
    print('Injury snapshot freshness:',int(fresh.sum()),'eligible of',len(d),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input',type=Path);parser.add_argument('--audit-public',action='store_true')
    args=parser.parse_args()
    if args.audit_public:public_snapshot_audit()
    if args.input:
        d=validate(pd.read_csv(args.input));path=INPUT/'imported_availability.csv';d[REQUIRED].to_csv(path,index=False)
        (OUT/'imported-availability-source.json').write_text(json.dumps(dict(input_sha256=digest(args.input),output_sha256=digest(path),rows=len(d)),indent=2)+'\n')
        print('Availability import validated:',len(d))
    if not args.input and not args.audit_public:parser.error('Supply --input or --audit-public')

if __name__=='__main__':main()
