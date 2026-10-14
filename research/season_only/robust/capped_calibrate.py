"""Probability-only calibration on the frozen 2014–2019 validation forecasts."""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit,logit

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from evaluate import metrics

OUT=HERE/'capped-results'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
protocol=dict(years=list(range(2014,2020)),method='One positive temperature, no intercept, minimizing log loss on the selected older-fold forecasts only. It preserves every winner pick and rank. No later outcomes are read.',sourceSha256=digest(Path(__file__)),selectionSha256=digest(OUT/'selection.json'))
path=OUT/'calibration-protocol.json'
if path.exists():assert json.loads(path.read_text())==protocol
else:path.write_text(json.dumps(protocol,indent=2)+'\n')
selection=json.loads((OUT/'selection.json').read_text())['chosen']
meta=pd.read_csv(OUT/'validation-games.csv');assert set(meta.year)==set(range(2014,2020))
p=np.load(OUT/f'validation-models/{selection["index"]}-loss-{int(selection["loss_penalty"])}.npy')
z=logit(np.clip(p,1e-10,1-1e-10));y=meta.y.to_numpy()
def objective(t):
    return np.mean(np.logaddexp(0,z*t[0])-y*z*t[0])+1e-6*t[0]**2,np.array([np.mean((expit(z*t[0])-y)*z)+2e-6*t[0]])
fit=minimize(objective,[1.],jac=True,method='L-BFGS-B',bounds=[(.2,3.)])
result=dict(protocolSha256=digest(path),temperature=float(fit.x[0]),before=metrics(y,p),after=metrics(y,expit(z*fit.x[0])))
(OUT/'calibration.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
print(json.dumps(result))
