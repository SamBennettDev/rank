"""Choose settings on 2014–2019. Later-season outcomes are not read for selection."""
import json,pickle
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
import numpy as np
import pandas as pd
from scipy.special import expit
from sklearn.ensemble import HistGradientBoostingClassifier,ExtraTreesClassifier
from sklearn.linear_model import LogisticRegression
from build import CACHE,OUT
from prepare import YEARS
from neural import Network,settings
from evaluate import metrics,calibrate

TRAIN_YEARS=list(range(2002,2014))
VALIDATION_YEARS=list(range(2014,2020))

def read_years(years):
    metas=[];arrays={k:[] for k in ['xh','xa','rh','ra','hfa']}
    for y in years:
        meta=pd.read_csv(CACHE/f'{y}.csv');data=np.load(CACHE/f'{y}.npz')
        metas.append(meta)
        for k in arrays:arrays[k].append(data[k])
    return pd.concat(metas,ignore_index=True),{k:np.concatenate(v) for k,v in arrays.items()}

def primary(meta):return (meta['mode']=='weekly') & meta.fbs.astype(bool)

def trial(setting):
    global TR,VA,TX,VX,SCALE
    models=[];tl=[];vl=[]
    for seed in [7,19,43]:
        net=Network(**setting,seed=seed,scale=SCALE.copy()).fit(TX['xh'],TX['xa'],TR.venue.to_numpy(),TR.y.to_numpy(),TR.margin.to_numpy())
        tl.append(net.logits(TX['xh'],TX['xa'],TR.venue.to_numpy()))
        vl.append(net.logits(VX['xh'],VX['xa'],VA.venue.to_numpy()))
        models.append(net.asdict())
    # Same ensemble rule at validation, evaluation and current rankings.
    tz=np.mean(tl,axis=0);vz=np.mean(vl,axis=0)
    beta,_=calibrate(tz,np.zeros(len(tz)),TR.y.to_numpy(),TR.margin.to_numpy())
    temperature=float(beta[0]);p=expit(vz*temperature)
    name=Network(**setting,seed=7,scale=SCALE).name
    result=dict(name=name,settings=setting,temperature=temperature,validation=metrics(VA.y,p),
                training=metrics(TR.y,expit(tz*temperature)),
                iterations=[m['iterations'] for m in models],converged=[m['converged'] for m in models])
    path=OUT/'networks'/f"{name.replace(':','_').replace(',','_')}.json"
    path.write_text(json.dumps(dict(**result,models=models),separators=(',',':'))+'\n')
    print('Neural',name,'validation accuracy',round(result['validation']['accuracy'],4),flush=True)
    return result,p

def key(m):return (-m['validation']['accuracy'],m['validation']['log_loss'])

def tree_inputs(h,a,v,scale):
    h=np.clip(h/scale,-8,8);a=np.clip(a/scale,-8,8)
    return np.c_[h-a,(h+a)/2,v],np.c_[a-h,(h+a)/2,-v]

def main():
    global TR,VA,TX,VX,SCALE
    (OUT/'networks').mkdir(exist_ok=True)
    tr,tx=read_years(TRAIN_YEARS);va,vx=read_years(VALIDATION_YEARS)
    ti=primary(tr).to_numpy();vi=primary(va).to_numpy()
    TR=tr[ti].reset_index(drop=True);VA=va[vi].reset_index(drop=True)
    TX={k:v[ti] for k,v in tx.items()};VX={k:v[vi] for k,v in vx.items()}
    SCALE=np.maximum(np.std(np.r_[TX['xh'],TX['xa']],axis=0),.01)
    methods=json.loads((OUT/'methods.json').read_text())
    statistical=[];stat_val=[];calibration=[]
    for j,m in enumerate(methods):
        te=TX['rh'][:,j]-TX['ra'][:,j];ve=VX['rh'][:,j]-VX['ra'][:,j]
        venue_tr=TR.venue.to_numpy()*TX['hfa'];venue_va=VA.venue.to_numpy()*VX['hfa']
        b,mb=calibrate(te,venue_tr,TR.y.to_numpy(),TR.margin.to_numpy())
        p=expit(b[0]*ve+b[1]*venue_va)
        statistical.append(dict(**m,validation=metrics(VA.y,p,VA.margin,mb[0]*ve+mb[1]*venue_va)))
        stat_val.append(p);calibration.append(dict(probability=b.tolist(),margin=mb.tolist()))
    selected={}
    for i,item in enumerate(statistical):
        family=item['family']
        if family not in selected or key(item)<key(statistical[selected[family]]):selected[family]=i
    (OUT/'statistical-design.json').write_text(json.dumps(statistical,indent=2)+'\n')
    print('Statistical design complete;',len(TR),'training and',len(VA),'validation FBS games',flush=True)
    trials=[];neural_val=[]
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result,p in pool.map(trial,settings()):trials.append(result);neural_val.append(p)
    ni=min(range(len(trials)),key=lambda i:key(trials[i]))
    (OUT/'neural-design.json').write_text(json.dumps(trials,indent=2)+'\n')
    # Strong current-season-only non-neural learners, with symmetry augmentation.
    t,ts=tree_inputs(TX['xh'],TX['xa'],TR.venue,SCALE)
    v,vs=tree_inputs(VX['xh'],VX['xa'],VA.venue,SCALE)
    yt=np.r_[TR.y,1-TR.y];xt=np.r_[t,ts]
    learners=[];learner_val=[]
    configs=[dict(family='logistic_features',C=c) for c in [.03,.3,3,30]]
    configs += [dict(family='gradient_boosting',depth=d,regularization=r,iterations=i)
                for d in [2,3,5] for r in [1.,10.] for i in [100,250]]
    configs += [dict(family='extra_trees',leaf=l,max_features=f) for l in [10,30,80] for f in [.5,1.]]
    for j,config in enumerate(configs):
        family=config['family']
        if family=='logistic_features':model=LogisticRegression(C=config['C'],max_iter=1000)
        elif family=='gradient_boosting':model=HistGradientBoostingClassifier(max_depth=config['depth'],l2_regularization=config['regularization'],max_iter=config['iterations'],learning_rate=.05,early_stopping=False,random_state=7)
        else:model=ExtraTreesClassifier(n_estimators=250,min_samples_leaf=config['leaf'],max_features=config['max_features'],random_state=7,n_jobs=3)
        model.fit(xt,yt);p=(model.predict_proba(v)[:,1]+1-model.predict_proba(vs)[:,1])/2
        name=','.join(f'{k}={val}' for k,val in config.items())
        record=dict(name=name,config=config,validation=metrics(VA.y,p))
        learners.append(record);learner_val.append(p)
        with open(CACHE/f'learner_{j}.pkl','wb') as f:pickle.dump(model,f)
        print('Learner',name,'validation accuracy',round(record['validation']['accuracy'],4),flush=True)
    ml_selected={}
    for j,item in enumerate(learners):
        f=item['config']['family']
        if f not in ml_selected or key(item)<key(learners[ml_selected[f]]):ml_selected[f]=j
    (OUT/'learner-design.json').write_text(json.dumps(learners,indent=2)+'\n')
    # Test whether neural/statistical or neural/tree ensembles improve winner selection.
    components={f'statistical:{f}':np.asarray(stat_val)[j] for f,j in selected.items()}
    components.update({f'learner:{f}':learner_val[j] for f,j in ml_selected.items()})
    pn=neural_val[ni];combinations=[dict(component=None,alpha=1.,validation=metrics(VA.y,pn))]
    for name,p in components.items():
        for alpha in [.25,.5,.75]:
            pred=alpha*pn+(1-alpha)*p
            combinations.append(dict(component=name,alpha=alpha,validation=metrics(VA.y,pred)))
    ei=min(range(len(combinations)),key=lambda i:key(combinations[i]))
    selection=dict(protocol=dict(training_years=TRAIN_YEARS,validation_years=VALIDATION_YEARS,
        evaluation_years=list(range(2020,2026)),criterion='highest validation winner accuracy; break ties with log loss',
        feature_scope='Numeric current-season statistics only. No team identity, conference, division, preseason, odds, poll, talent or prior-year team data.',
        evaluation_status='Later seasons include previously inspected repository development data; not a pristine holdout.'),
        statistical_indices=selected,calibration=calibration,neural_index=ni,neural=trials[ni],
        learner_indices=ml_selected,feature_scale=SCALE.tolist(),ensemble=combinations[ei],
        counts=dict(statistical_configurations=len(methods),statistical_families=len(selected),neural_settings=len(trials),
        neural_networks=len(trials)*3,learner_configurations=len(learners),ensemble_settings=len(combinations)),
        training_games=len(TR),validation_games=len(VA))
    (OUT/'ensemble-design.json').write_text(json.dumps(combinations,indent=2)+'\n')
    (OUT/'selection.json').write_text(json.dumps(selection,indent=2)+'\n')
    chosen=trials[ni]['name'].replace(':','_').replace(',','_')+'.json'
    (OUT/'selected-network.json').write_text((OUT/'networks'/chosen).read_text())
    print('FROZEN SELECTION:',selection['neural']['name'],selection['ensemble'],flush=True)

if __name__=='__main__':main()
