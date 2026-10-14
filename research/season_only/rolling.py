"""Annual expanding-window refits of the frozen design; no future-year outcomes."""
import json
import pickle
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from scipy.special import expit,logit
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier,ExtraTreesClassifier
from train import read_years,primary,tree_inputs
from build import CACHE,OUT
from evaluate import calibrate
from neural import Network

def fit_year(year):
    selection=json.loads((OUT/'selection.json').read_text())
    meta,data=read_years(list(range(2002,year)))
    sel=primary(meta).to_numpy();meta=meta[sel].reset_index(drop=True);data={k:v[sel] for k,v in data.items()}
    scale=np.maximum(np.std(np.r_[data['xh'],data['xa']],axis=0),.01)
    x=data['xh'];a=data['xa'];v=meta.venue.to_numpy();y=meta.y.to_numpy();margin=meta.margin.to_numpy()
    models=[];train_logits=[]
    for seed in [7,19,43]:
        net=Network(**selection['neural']['settings'],seed=seed,scale=scale).fit(x,a,v,y,margin)
        models.append(net.asdict());train_logits.append(net.logits(x,a,v))
    tz=np.mean(train_logits,axis=0)
    beta,mb=calibrate(tz,np.zeros(len(tz)),y,margin)
    t,ts=tree_inputs(x,a,v,scale)
    designs=json.loads((OUT/'learner-design.json').read_text())
    linear_index=selection['learner_indices']['logistic_features']
    C=designs[linear_index]['config']['C']
    model=LogisticRegression(C=C,max_iter=1000).fit(np.r_[t,ts],np.r_[y,1-y])
    # Export the linear ensemble member without a pickle dependency.
    linear=dict(coef=model.coef_[0].tolist(),intercept=float(model.intercept_[0]),scale=scale.tolist())
    target=np.load(CACHE/f'{year}.npz')
    forecast_meta,forecast_data=read_years([year])
    t0,t1=tree_inputs(forecast_data['xh'],forecast_data['xa'],forecast_meta.venue,scale)
    learner_predictions={}
    for family in ['gradient_boosting','extra_trees']:
        j=selection['learner_indices'][family];config=designs[j]['config']
        if family=='gradient_boosting':
            learner=HistGradientBoostingClassifier(max_depth=config['depth'],l2_regularization=config['regularization'],max_iter=config['iterations'],learning_rate=.05,early_stopping=False,random_state=7)
        else:
            learner=ExtraTreesClassifier(n_estimators=250,min_samples_leaf=config['leaf'],max_features=config['max_features'],random_state=7,n_jobs=1)
        learner.fit(np.r_[t,ts],np.r_[y,1-y])
        learner_predictions[family]=(learner.predict_proba(t0)[:,1]+1-learner.predict_proba(t1)[:,1])/2
        with open(CACHE/f'{family}_{year}.pkl','wb') as f:pickle.dump(learner,f)
    np.savez_compressed(CACHE/f'rolling_learners_{year}.npz',**learner_predictions)
    stat_calibration=[]
    for j in range(data['rh'].shape[1]):
        b,mb=calibrate(data['rh'][:,j]-data['ra'][:,j],v*data['hfa'],y,margin)
        stat_calibration.append(dict(probability=b.tolist(),margin=mb.tolist()))
    obj=dict(year=year,training_years=list(range(2002,year)),training_games=len(y),models=models,
             temperature=float(beta[0]),margin_scale=float(calibrate(tz,np.zeros(len(tz)),y,margin)[1][0]),linear=linear,
             settings=selection['neural']['settings'],statistical_calibration=stat_calibration)
    (OUT/'rolling-models'/f'{year}.json').write_text(json.dumps(obj,separators=(',',':'))+'\n')
    print(f'Annual neural refit for {year}, using {len(y)} prior-season games',flush=True)
    return year

def predict(obj,h,a,v):
    z=np.mean([Network.fromdict(m).logits(h,a,v) for m in obj['models']],axis=0)
    neural=expit(z*obj['temperature'])
    lin=obj['linear'];t,ts=tree_inputs(h,a,v,np.array(lin['scale']))
    w=np.array(lin['coef']);b=lin['intercept']
    linear=(expit(t@w+b)+1-expit(ts@w+b))/2
    return neural,linear,z*obj['margin_scale']

if __name__=='__main__':
    (OUT/'rolling-models').mkdir(exist_ok=True)
    # Early-year results are hindcasts: architecture selection used later 2014–2019.
    with ProcessPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fit_year,range(2007,2027)):pass
