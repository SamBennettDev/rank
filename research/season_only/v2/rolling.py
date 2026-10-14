"""Annual refits of the four validation-selected feature variants."""
import json
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
from common import OUT,CACHE
from model import FEATURE_SETS,read_years,train,predict,save_model,load_model,combine
from build import CACHE as OLD_CACHE
from rich_build import RICH_CACHE
from graph_build import GRAPH_CACHE

def selections():
    rows=json.loads((OUT/'design.json').read_text())
    return {feature:min([r for r in rows if r['settings']['feature_set']==feature],
        key=lambda r:(-r['validation']['utility'],r['validation']['pooled']['log_loss'])) for feature in FEATURE_SETS}

def fit_year(task):
    year,feature=task;chosen=selections()[feature];cfg=chosen['settings']
    meta,h,a=read_years(list(range(2006,year)),feature)
    obj=train(meta,h,a,cfg);obj.update(year=year,alpha=chosen['alpha'])
    save_model(OUT/'models'/f'{feature}_{year}.json.gz',obj)
    m=pd.read_csv(OLD_CACHE/f'{year}.csv');r=np.load(RICH_CACHE/f'{year}.npz');g=np.load(GRAPH_CACHE/f'{year}.npz');x=np.load(CACHE/f'{year}.npz')
    h=combine(r['xh'],g['xh'],x['xh'],feature);a=combine(r['xa'],g['xa'],x['xa'],feature)
    np.save(CACHE/f'prediction_{feature}_{year}.npy',predict(obj,h,a,m.venue.to_numpy()))
    print('Annual V2 fit',year,feature,len(meta),'earlier games',flush=True)

if __name__=='__main__':
    (OUT/'models').mkdir(exist_ok=True)
    (OUT/'feature-selections.json').write_text(json.dumps(selections(),indent=2)+'\n')
    tasks=[(year,feature) for year in range(2007,2027) for feature in FEATURE_SETS]
    with ProcessPoolExecutor(max_workers=3) as pool:
        for _ in pool.map(fit_year,tasks):pass
