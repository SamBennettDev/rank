"""Post-selection exploratory evaluation. This file never changes selection.json."""
import json
import numpy as np
import pandas as pd
from scipy.special import expit
from prepare import YEARS
from train import read_years,primary
from build import OUT,CACHE
from neural import Network
from evaluate import metrics

def main():
    meta,data=read_years(YEARS+[2026]);mask=primary(meta)&meta.year.between(2020,2025)
    methods=json.loads((OUT/'methods.json').read_text());stats=[]
    for j,m in enumerate(methods):
        p=np.zeros(len(meta))
        for yr in range(2020,2026):
            ix=np.flatnonzero(meta.year==yr)
            obj=json.loads((OUT/'rolling-models'/f'{yr}.json').read_text());b=obj['statistical_calibration'][j]['probability']
            edge=data['rh'][ix,j]-data['ra'][ix,j]
            p[ix]=expit(b[0]*edge+b[1]*meta.venue.iloc[ix].to_numpy()*data['hfa'][ix])
        stats.append(dict(**m,exploratory_development=metrics(meta.y[mask],p[mask])))
    (OUT/'all-statistical-development.json').write_text(json.dumps(stats,indent=2)+'\n')
    current=np.load(CACHE/'2026.npz');x=current['snapshot_x'];n=len(x)
    h=np.repeat(x,n,axis=0);a=np.tile(x,(n,1));ranks=[];nets=[]
    for file in sorted((OUT/'networks').glob('*.json')):
        d=json.loads(file.read_text());models=[Network.fromdict(m) for m in d['models']]
        z=np.mean([m.logits(data['xh'][mask],data['xa'][mask],meta.venue[mask].to_numpy()) for m in models],axis=0)
        nets.append(dict(name=d['name'],settings=d['settings'],exploratory_development=metrics(meta.y[mask],expit(z*d['temperature']))))
        zc=np.mean([m.logits(h,a,np.zeros(n*n)) for m in models],axis=0)
        strength=expit(zc*d['temperature']).reshape(n,n).mean(1)
        index=np.flatnonzero(current['fbs']);order=index[np.argsort(-strength[index],kind='stable')]
        for pos,i in enumerate(order,1):ranks.append(dict(method=d['name'],rank=pos,team_id=int(current['team_ids'][i]),team=str(current['team_names'][i]),score=float(strength[i])))
    (OUT/'all-neural-development.json').write_text(json.dumps(nets,indent=2)+'\n')
    pd.DataFrame(ranks).to_csv(OUT/'week6-all-neural-configurations.csv',index=False,float_format='%.10f')
    print('Exploratory audits:',len(stats),'statistical and',len(nets),'neural settings')

if __name__=='__main__':main()
