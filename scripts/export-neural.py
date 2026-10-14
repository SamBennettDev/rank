"""Export causal numeric snapshots and frozen neural weights for browser inference.

No model fitting occurs here. Current-season scores/plays establish features;
historical shared weights are the previously selected 75% rich / 25% graph blend.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
RESEARCH=ROOT/'research/season_only'
sys.path.insert(0,str(RESEARCH))
import numpy as np
import pandas as pd
from scipy.special import expit
from data import Season,LAG
from graph_build import graph_features,GRAPH_NAMES
from neural import Network
from robust.network import RobustRanker
from robust.bounded_network import BoundedRanker
from robust.capped_features import build as capped_features,NAMES as CAPPED_NAMES


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def probability(groups,x,h,a,v,policy=None,games=None,losses=None):
    if policy:
        models=[]
        for m in groups[0]['components'][0]['networks']:
            obj=dict(m);obj.pop('kind',None)
            models.append((BoundedRanker if 'anchorScale'in policy else RobustRanker).fromdict(obj))
        return expit(groups[0]['components'][0]['temperature']*np.mean([m.logits(x[h],x[a],games[h],games[a],losses[h],losses[a],v)for m in models],axis=0))
    result=np.zeros(len(h))
    for group in groups:
        d=group['featureCount']; logits=[]
        for component in group['components']:
            z=np.mean([Network.fromdict(m).logits(x[h,:d],x[a,:d],v) for m in component['networks']],axis=0)
            logits.append(z*component['temperature'])
        result+=group['weight']*expit(np.mean(logits,axis=0))
    return result


def refresh_rich(year,directory):
    import rich_prepare as rp
    # Reuse the public parquet downloaded by fetch-plays in the same update job.
    rp.CACHE=Path(tempfile.gettempdir())/'rank-pbp'
    rp.CACHE.mkdir(exist_ok=True)
    raw=rp.CACHE/f'pbp_{year}.parquet'
    url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfbfastR_cfb_pbp/play_by_play_{year}.parquet'
    rp.download(url,raw)
    with tempfile.TemporaryDirectory(prefix='rank-rich-export-') as tmp:
        rp.INPUT=Path(tmp)
        _,source=rp.prepare(year)
        shutil.copyfile(rp.INPUT/f'rich_{year}.csv',directory/'rich.csv')
    (directory/'rich-source.json').write_text(json.dumps(dict(url=url,**source),indent=2)+'\n')


def export(year,refresh=False):
    directory=ROOT/f'data/seasons/{year}'
    robust=json.loads((directory/'config.json').read_text()).get('neural',{}).get('model')=='season-only-robust-loss-v2'
    rpath=RESEARCH/f'results/rich-rolling-models/{year}.json'
    gpath=RESEARCH/f'results/graph-rolling-models/{year}.json'
    if not robust and (not rpath.exists() or not gpath.exists()):
        raise ValueError(f'No saved annual neural weights for {year}; train and validate that annual model before enabling it.')
    if refresh:refresh_rich(year,directory)
    if not (directory/'rich.csv').exists():
        archived=RESEARCH/f'inputs/rich_{year}.csv'
        if not archived.exists():raise ValueError('Missing rich statistics; run with --refresh-rich after fetch-plays.')
        shutil.copyfile(archived,directory/'rich.csv')
        source=json.loads((RESEARCH/'rich-sources.json').read_text())[str(year)]
        (directory/'rich-source.json').write_text(json.dumps(dict(archive=f'research/season_only/inputs/rich_{year}.csv',**source),indent=2)+'\n')
    plan=json.loads(subprocess.check_output([str(ROOT/'node_modules/.bin/tsx'),str(ROOT/'scripts/neural-snapshots.ts'),str(year)],cwd=ROOT,text=True))
    teams=pd.read_csv(directory/'teams.csv').set_index('id').loc[plan['teamIds']].reset_index()
    raw=pd.read_csv(directory/'games.csv')
    g=raw.rename(columns={'id':'game_id','home_id':'home','away_id':'away'})
    g=g[g.completed.astype(str).str.lower().eq('true')&g.home_points.notna()&g.away_points.notna()&g.home_points.ne(g.away_points)].copy()
    ids=teams.id.to_numpy(int);ix={t:i for i,t in enumerate(ids)}
    g=g[g.home.isin(ix)&g.away.isin(ix)].copy()
    g['h']=g.home.map(ix).astype(int);g['a']=g.away.map(ix).astype(int)
    g['time']=pd.to_datetime(g.start_date,utc=True).map(lambda t:t.timestamp())
    g['margin']=g.home_points-g.away_points;g['venue']=(~g.neutral_site.astype(bool)).astype(float)
    g=g.sort_values(['time','game_id']).reset_index(drop=True)
    plays=pd.read_csv(directory/'plays.csv')
    plays=plays[plays.team_id.isin(ix)&plays.opponent_id.isin(ix)&plays.game_id.isin(g.game_id)].copy()
    plays['t']=plays.team_id.map(ix).astype(int);plays['u']=plays.opponent_id.map(ix).astype(int)
    gm=g.set_index('game_id')
    plays['site']=np.where(plays.team_id==plays.game_id.map(gm.home),1,-1)*plays.game_id.map(gm.venue)
    for name in ['snaps','epa','success']:plays['all_'+name]=plays[name]
    s=Season(year,ids,teams.school.tolist(),teams.classification.eq('fbs').to_numpy(),g,plays,len(ids))
    rich=pd.read_csv(directory/'rich.csv')
    policy=None
    if robust:
        robust_path=RESEARCH/f'robust/polished-results/annual-models/{year}.json'
        model=json.loads(robust_path.read_text());training=model['training_years']
        assert max(training)<year
        first=model['models'][0]
        policy=dict(evidencePrior=first['evidence_prior'],lossPenalty=first['loss_penalty'],lossPrior=first['loss_prior'],inputClip=first['clip'])
        policy.update(anchorScale=first['anchor_scale'],residualLimit=first['residual_limit'])
        policy['scoreMarginCap']=35.
        calibration_path=RESEARCH/'robust/polished-results/calibration.json'
        calibration=json.loads(calibration_path.read_text())
        groups=[dict(name='robust',weight=1.,featureCount=len(CAPPED_NAMES),components=[dict(temperature=calibration['temperature'],networks=[dict(kind='rank',**m)for m in model['models']])])]
    else:
        rmodel=json.loads(rpath.read_text());gmodel=json.loads(gpath.read_text())
        training=rmodel['training_years']
        assert training==gmodel['training_years'] and max(training)<year
        groups=[dict(name='rich',weight=.75,featureCount=64,components=[dict(temperature=c['temperature'],networks=c['models'])for c in rmodel['components']]),
                dict(name='graph',weight=.25,featureCount=152,components=[dict(temperature=gmodel['temperature'],networks=gmodel['models'])])]
    snapshots=[];parity=[]
    for snap in plan['snapshots']:
        cutoff=pd.Timestamp(snap['asOf']).timestamp()
        indices=np.flatnonzero(g.game_id.isin(snap['gameIds']))
        assert set(g.iloc[indices].game_id)==set(snap['gameIds'])
        assert np.all(g.iloc[indices].time+LAG<=cutoff)
        graph=None if robust else graph_features(s,indices,rich)
        if robust:x,(games,losses)=capped_features(s,indices,rich)
        else:x=graph
        assert x.shape==(s.n,len(CAPPED_NAMES)if robust else 152) and np.isfinite(x).all()
        extra={};kwargs={}
        if robust:
            extra=dict(gamesPlayed=games.tolist(),losses=losses.tolist(),externalLosses=snap['externalLosses'],recordGamesPlayed=snap['recordGamesPlayed'])
            kwargs=dict(policy=policy,games=games,losses=losses+np.array(snap['externalLosses']))
        snapshots.append(dict(id=snap['id'],asOf=snap['asOf'],gameIds=snap['gameIds'],features=x.tolist(),**extra))
        # Independent Python reference values for the browser/Node network port.
        h=np.repeat(np.arange(s.n),s.n);a=np.tile(np.arange(s.n),s.n)
        neutral=probability(groups,x,h,a,np.zeros(len(h)),**kwargs).reshape(s.n,s.n).mean(axis=1)
        cases=[]
        for home,away in [(0,1),(1,0),(10,30),(30,10),(20,20)]:
            for venue in [0.,1.,-1.]:
                p=float(probability(groups,x,np.array([home]),np.array([away]),np.array([venue]),**kwargs)[0])
                cases.append(dict(home=home,away=away,venue=venue,probability=p))
        parity.append(dict(id=snap['id'],neutralScores=neutral.tolist(),matchups=cases))
        print(f'Neural features {year}/{snap["id"]}: {len(indices)} completed games',flush=True)
    code=['features.py','models.py','rich_build.py','graph_build.py','neural.py']
    if robust:code+=['robust/features.py','robust/capped_features.py','robust/bounded_network.py']
    model_source=dict(robustModelSha256=digest(robust_path),calibrationSha256=digest(calibration_path))if robust else dict(richModelSha256=digest(rpath),graphModelSha256=digest(gpath))
    bundle=dict(schema=2 if robust else 1,model='season-only-robust-loss-v2'if robust else 'season-only-rich-graph-v1',year=year,trainingYears=training,teamIds=ids.tolist(),
                source=dict(teamsSha256=digest(directory/'teams.csv'),gamesSha256=digest(directory/'games.csv'),
                            playsSha256=digest(directory/'plays.csv'),richSha256=digest(directory/'rich.csv'),
                            featureCode={name:digest(RESEARCH/name)for name in code},
                            **model_source),
                featureNames=CAPPED_NAMES if robust else GRAPH_NAMES,groups=groups,snapshots=snapshots,**(dict(policy=policy)if policy else {}))
    (directory/'neural.json').write_text(json.dumps(bundle,separators=(',',':'),allow_nan=False)+'\n')
    target=directory/'neural-parity.json'
    target.write_text(json.dumps(dict(year=year,bundleSha256=digest(directory/'neural.json'),snapshots=parity),separators=(',',':'))+'\n')
    print(f'Exported {len(snapshots)} neural snapshots, {s.n} teams, {sum(len(c["networks"])for g in groups for c in g["components"])} trained networks',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--year',type=int,default=2026)
    parser.add_argument('--refresh-rich',action='store_true')
    args=parser.parse_args();export(args.year,args.refresh_rich)
