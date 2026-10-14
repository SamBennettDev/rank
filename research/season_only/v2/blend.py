"""Older-fold selection of a conservative V1/V2 probability blend."""
import json
from datetime import datetime,timezone
import numpy as np
import pandas as pd
from common import OUT,CACHE,PARENT
from model import read_years,score,game_counts,early_gate
from rich_build import RICH_CACHE
from graph_build import GRAPH_CACHE
from graph_evaluate import probability as graph_probability
from rich_evaluate import model_probability as rich_probability
from prepare import digest

def mix(v2,v1,h,a,policy):
    w=policy['v2_weight']*(early_gate(h,a) if policy['gate']=='sample_size' else np.ones(len(h)))
    return (1-w)*v1+w*v2

def main():
    protocol=dict(frozen_at=datetime.now(timezone.utc).isoformat(),validation_years=list(range(2014,2020)),
        gates=['constant','sample_size'],weights=[0.,.25,.5,.75,1.],
        criterion='Highest macro-season overall winner accuracy; tie by macro-season early accuracy, then pooled log loss.',
        interpretation='Additional older-fold selection before reading V2 later-season results; all results remain retrospective development.',
        source_selection_sha256=digest(OUT/'selection.json'))
    (OUT/'blend-protocol.json').write_text(json.dumps(protocol,indent=2)+'\n')
    selected=json.loads((OUT/'selection.json').read_text())['chosen'];feature=selected['settings']['feature_set']
    from train_experts import settings,FOLDS
    idx=settings().index(selected['settings']);val=np.load(CACHE/f'validation_{idx}.npz')
    pv2=(1-selected['alpha']*val['gate'])*val['global_p']+selected['alpha']*val['gate']*val['early_p']
    metas=[];old=[];hs=[];aas=[]
    for _,years in FOLDS:
        first=years[0];rmodel=json.loads((PARENT/'results/rich-rolling-models'/f'{first}.json').read_text())
        gmodel=json.loads((PARENT/'results/graph-rolling-models'/f'{first}.json').read_text())
        for year in years:
            m,h,a=read_years([year],feature);m['early_sample']=np.minimum(game_counts(h),game_counts(a))<=5+1e-8
            from build import CACHE as OLD_CACHE
            full=pd.read_csv(OLD_CACHE/f'{year}.csv');mask=(full['mode']=='weekly')&full.fbs
            r=np.load(RICH_CACHE/f'{year}.npz');g=np.load(GRAPH_CACHE/f'{year}.npz');v=m.venue.to_numpy()
            pr=rich_probability(rmodel,r['xh'][mask],r['xa'][mask],v)
            pg=graph_probability(gmodel,g['xh'][mask],g['xa'][mask],v)
            old.append(.75*pr+.25*pg);metas.append(m);hs.append(h);aas.append(a)
    meta=pd.concat(metas,ignore_index=True);pold=np.concatenate(old);h=np.concatenate(hs);a=np.concatenate(aas)
    assert len(meta)==len(pv2)
    rows=[]
    for gate in protocol['gates']:
        for weight in protocol['weights']:
            policy=dict(gate=gate,v2_weight=weight);p=mix(pv2,pold,h,a,policy)
            rows.append(dict(**policy,validation=score(meta,p)))
    chosen=min(rows,key=lambda r:(-r['validation']['macro_season_accuracy'],-r['validation']['macro_early_accuracy'],r['validation']['pooled']['log_loss']))
    (OUT/'blend-selection.json').write_text(json.dumps(dict(chosen=chosen,design=rows,baseline=score(meta,pold),v2_foundation=score(meta,pv2)),indent=2)+'\n')
    evidence=meta[['year','game_id','early_sample','y']].copy();evidence['p_v1']=pold;evidence['p_v2']=pv2;evidence['early_gate']=early_gate(h,a)
    evidence.to_csv(OUT/'blend-validation-predictions.csv',index=False,float_format='%.10f')
    print('Conservative V1/V2 blend selection',chosen,flush=True)

if __name__=='__main__':main()
