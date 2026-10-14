"""Predeclared multi-period chronological selection; no later-season selection labels."""
import json
import hashlib
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from common import CACHE, OUT, PARENT
from prepare import digest
from model import FEATURE_SETS, read_years, game_counts, early_gate, train, probabilities, score, save_model

FOLDS=[(list(range(2006,2014)),[2014,2015]),(list(range(2006,2016)),[2016,2017]),
       (list(range(2006,2018)),[2018,2019])]

def settings():
    return [dict(feature_set=f,kind=k,width=w,ridge=r) for f in FEATURE_SETS
            for k in ['rank','matchup'] for w in [8,16] for r in [.01,.1]]

def trial(config):
    ix=settings().index(config);existing=CACHE/f'validation_{ix}.npz'
    if existing.exists() and 'input_signature' in np.load(existing).files and str(np.load(existing)['input_signature'])==SIGNATURES[config['feature_set']]:
        saved=np.load(existing);m=pd.concat([item[3] for item in DATA[config['feature_set']]],ignore_index=True)
        rows=[]
        for alpha in [0.,.5,1.]:
            p=(1-alpha*saved['gate'])*saved['global_p']+alpha*saved['gate']*saved['early_p']
            rows.append(dict(settings=config,alpha=alpha,validation=score(m,p)))
        print('Reused unchanged completed candidate',ix,flush=True)
        return rows
    rows=[];meta=[];global_p=[];early_p=[];gate=[]
    for fold,(tr,va) in enumerate(FOLDS):
        tm,h,a,vm,vh,va_x=DATA[config['feature_set']][fold]
        obj=train(tm,h,a,config);pp=probabilities(obj,vh,va_x,vm.venue.to_numpy())
        save_model(CACHE/f'fold_{settings().index(config)}_{fold}.json.gz',obj)
        meta.append(vm);global_p.append(pp['global']);early_p.append(pp['early']);gate.append(early_gate(vh,va_x))
    m=pd.concat(meta,ignore_index=True);pg=np.concatenate(global_p);pe=np.concatenate(early_p);g=np.concatenate(gate)
    for alpha in [0.,.5,1.]:
        p=(1-alpha*g)*pg+alpha*g*pe
        rows.append(dict(settings=config,alpha=alpha,validation=score(m,p)))
    ix=settings().index(config)
    np.savez_compressed(CACHE/f'validation_{ix}.npz',global_p=pg,early_p=pe,gate=g,input_signature=SIGNATURES[config['feature_set']])
    print('V2 candidate',ix,config,'best utility',round(max(r['validation']['utility'] for r in rows),4),flush=True)
    return rows

if __name__=='__main__':
    from datetime import datetime, timezone
    protocol=dict(frozen_at=datetime.now(timezone.utc).isoformat(),folds=[dict(training=tr,validation=va) for tr,va in FOLDS],settings=settings(),alphas=[0.,.5,1.],
        criterion='Mean of macro-season overall winner accuracy and macro-season low-evidence accuracy; tie by pooled log loss.',
        low_evidence='Either team has at most five completed current-season games.',
        forbidden_selection_years=list(range(2020,2027)),status='All historical tests are retrospective development; future games after protocol freeze are prospective.',
        source_manifest_sha256=digest(OUT/'context-sources.json'),
        code_sha256={p.name:digest(p) for p in [__import__('pathlib').Path(__file__),__import__('pathlib').Path(__file__).with_name('model.py'),__import__('pathlib').Path(__file__).with_name('context_features.py')]})
    (OUT/'protocol.json').write_text(json.dumps(protocol,indent=2)+'\n')
    DATA={};SIGNATURES={}
    for feature in FEATURE_SETS:
        DATA[feature]=[]
        for training,validation in FOLDS:
            tm,h,a=read_years(training,feature);vm,vh,va=read_years(validation,feature)
            vm['early_sample']=np.minimum(game_counts(vh),game_counts(va))<=5+1e-8
            DATA[feature].append((tm,h,a,vm,vh,va))
        signature=hashlib.sha256()
        signature.update(json.dumps(settings(),sort_keys=True).encode())
        signature.update(__import__('pathlib').Path(__file__).with_name('model.py').read_bytes())
        for item in DATA[feature]:
            for value in [item[1],item[2],item[4],item[5]]:signature.update(np.ascontiguousarray(value).tobytes())
            for meta in [item[0],item[3]]:signature.update(meta[['game_id','year','y','margin','venue']].to_csv(index=False).encode())
        SIGNATURES[feature]=signature.hexdigest()
    with ProcessPoolExecutor(max_workers=3) as pool:
        rows=[r for trial_rows in pool.map(trial,settings()) for r in trial_rows]
    chosen=min(rows,key=lambda r:(-r['validation']['utility'],r['validation']['pooled']['log_loss']))
    (OUT/'design.json').write_text(json.dumps(rows,indent=2)+'\n')
    (OUT/'selection.json').write_text(json.dumps(dict(chosen=chosen,configurations=len(settings()),blend_candidates=len(rows),
        experimental_network_fits=len(settings())*len(FOLDS)*6,protocol_sha256=digest(OUT/'protocol.json')),indent=2)+'\n')
    print('V2 SELECTION',chosen,flush=True)
