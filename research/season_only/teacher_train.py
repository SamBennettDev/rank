"""Historical market distillation: prices are training targets, never inference inputs."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from scipy.special import expit
from rich_train import read_rich
from graph_train import read_graph
from neural import Network
from train import primary
from evaluate import metrics,calibrate
from build import OUT

TEACHER_OUT=OUT/'teacher-networks'

def settings():
    return [dict(feature_set=f,kind=k,width=w,ridge=r,teacher_alpha=a) for f in ['rich','graph']
       for k in ['rank','matchup'] for w in [8,16] for r in [.003,.01,.03] for a in [.25,.5,.75]]

def trial(config):
    feature=config['feature_set'];tr,tx,va,vx,scale=DATA[feature]
    cfg={k:config[k] for k in ['kind','width','ridge']}
    cfg.update(auxiliary=.03,focus=0.)
    observed=tr.y.to_numpy();market=tr.game_id.map(ODDS).to_numpy();alpha=config['teacher_alpha']
    target=np.where(np.isfinite(market),(1-alpha)*observed+alpha*market,observed)
    weights=2**((tr.year.to_numpy()-tr.year.max())/4)
    models=[];tz=[];vz=[]
    for seed in [7,19,43]:
        net=Network(**cfg,seed=seed,scale=scale).fit(tx['xh'],tx['xa'],tr.venue.to_numpy(),target,tr.margin.to_numpy(),maxiter=350,sample_weights=weights)
        models.append(net.asdict());tz.append(net.logits(tx['xh'],tx['xa'],tr.venue.to_numpy()));vz.append(net.logits(vx['xh'],vx['xa'],va.venue.to_numpy()))
    z=np.mean(tz,axis=0);b,mb=calibrate(z,np.zeros(len(z)),observed,tr.margin.to_numpy())
    result=dict(settings=config,validation=metrics(va.y,expit(np.mean(vz,axis=0)*b[0])),temperature=float(b[0]),margin_scale=float(mb[0]),
        training_market_games=int(np.isfinite(market).sum()),iterations=[m['iterations'] for m in models],converged=[m['converged'] for m in models])
    j=settings().index(config);(TEACHER_OUT/f'{j}.json').write_text(json.dumps(dict(**result,models=models),separators=(',',':'))+'\n')
    print('Historical market target trial',j,round(result['validation']['accuracy'],4),flush=True)
    return result

if __name__=='__main__':
    TEACHER_OUT.mkdir(exist_ok=True);ODDS=pd.read_csv(__import__('prepare').INPUT/'odds.csv').set_index('game_id').moneyline_p
    DATA={}
    for name,read in [('rich',read_rich),('graph',read_graph)]:
        tr,tx=read(list(range(2006,2018)));va,vx=read([2018,2019]);tm=primary(tr).to_numpy();vm=primary(va).to_numpy()
        tr=tr[tm].reset_index(drop=True);va=va[vm].reset_index(drop=True);tx={k:v[tm] for k,v in tx.items()};vx={k:v[vm] for k,v in vx.items()}
        scale=np.maximum(np.std(np.r_[tx['xh'],tx['xa']],axis=0),.01);DATA[name]=(tr,tx,va,vx,scale)
    with ProcessPoolExecutor(max_workers=3) as pool:results=list(pool.map(trial,settings()))
    best=min(range(len(results)),key=lambda j:(-results[j]['validation']['accuracy'],results[j]['validation']['log_loss']))
    (OUT/'teacher-design.json').write_text(json.dumps(results,indent=2)+'\n')
    (OUT/'teacher-selection.json').write_text(json.dumps(dict(index=best,chosen=results[best],settings=len(results),networks=len(results)*3,
        training_years=list(range(2006,2018)),validation_years=[2018,2019],training_half_life=4.,
        interpretation='Historical moneyline probabilities are additional labels, not model features. No live betting prices or team identity enter inference.',
        protocol='Exploratory fourth design round. Outcomes and quoted probabilities from prior seasons train shared weights; later-season results are development data.'),indent=2)+'\n')
    print('TEACHER SELECTION',best,results[best],flush=True)
