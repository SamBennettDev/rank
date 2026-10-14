"""Check a larger optimization budget on the already selected design, using validation only."""
import json
import numpy as np
from scipy.special import expit
import pandas as pd
from teacher_train import settings,TEACHER_OUT
from rich_train import read_rich
from graph_train import read_graph
from train import primary
from prepare import INPUT
from build import OUT
from neural import Network
from evaluate import metrics,calibrate

if __name__=='__main__':
    selection=json.loads((OUT/'teacher-selection.json').read_text());config=selection['chosen']['settings']
    read=read_rich if config['feature_set']=='rich' else read_graph
    tr,tx=read(list(range(2006,2018)));va,vx=read([2018,2019]);tm=primary(tr).to_numpy();vm=primary(va).to_numpy()
    tr=tr[tm].reset_index(drop=True);va=va[vm].reset_index(drop=True);tx={k:v[tm] for k,v in tx.items()};vx={k:v[vm] for k,v in vx.items()}
    scale=np.maximum(np.std(np.r_[tx['xh'],tx['xa']],axis=0),.01);odds=pd.read_csv(INPUT/'odds.csv').set_index('game_id').moneyline_p
    actual=tr.y.to_numpy();market=tr.game_id.map(odds).to_numpy();alpha=config['teacher_alpha']
    target=np.where(np.isfinite(market),(1-alpha)*actual+alpha*market,actual);weights=2**((tr.year.to_numpy()-tr.year.max())/4)
    models=[];tz=[];vz=[]
    for seed in [7,19,43]:
        cfg={k:config[k] for k in ['kind','width','ridge']}
        n=Network(**cfg,auxiliary=.03,seed=seed,scale=scale).fit(tx['xh'],tx['xa'],tr.venue.to_numpy(),target,tr.margin.to_numpy(),maxiter=1500,sample_weights=weights,optimizer_memory=40)
        models.append(n.asdict());tz.append(n.logits(tx['xh'],tx['xa'],tr.venue.to_numpy()));vz.append(n.logits(vx['xh'],vx['xa'],va.venue.to_numpy()))
    z=np.mean(tz,axis=0);b,mb=calibrate(z,np.zeros(len(z)),actual,tr.margin.to_numpy())
    result=dict(settings=config,validation=metrics(va.y,expit(np.mean(vz,axis=0)*b[0])),temperature=float(b[0]),margin_scale=float(mb[0]),
        training_market_games=int(np.isfinite(market).sum()),iterations=[m['iterations'] for m in models],converged=[m['converged'] for m in models])
    (OUT/'teacher-polish.json').write_text(json.dumps(result,indent=2)+'\n')
    old=selection['chosen']['validation'];new=result['validation']
    improve=(-new['accuracy'],new['log_loss'])<(-old['accuracy'],old['log_loss'])
    selection['optimizer_budget']=dict(maxiter=1500,optimizer_memory=40) if improve else dict(maxiter=350,optimizer_memory=10)
    selection['optimization_check']=dict(improved_validation=improve,new=result)
    if improve:
        selection['chosen']=result
        (OUT/'teacher-polished-network.json').write_text(json.dumps(dict(**result,models=models),separators=(',',':'))+'\n')
    (OUT/'teacher-selection.json').write_text(json.dumps(selection,indent=2)+'\n')
    print('Optimization refinement',selection['optimizer_budget'],result,flush=True)
