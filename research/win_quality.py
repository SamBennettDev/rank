"""Reproduce the win-quality v2 design study from pinned 2014-2019 data.

Requires NumPy/SciPy and the cached schedules downloaded by scripts/history.ts.
The FBS benchmark and balanced scale are scoring policies. Priors and ridge
strength are calibrated on design years; current team ranks never select settings.
Run: OPENBLAS_NUM_THREADS=1 python research/win_quality.py
"""
import sys,csv,json,hashlib
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
from scipy.linalg import cho_factor,cho_solve
REV='a3dd960090c1bfa169cebd491beabf7028b379b2';SIGMA=14.934045;SCALE=12.;EPOCH=datetime(1970,1,5,12,tzinfo=timezone.utc).timestamp()
def load(year):
 path=Path(f'/tmp/rank-backtest/cfb_schedules_{REV}_{year}.csv');raw=path.read_bytes();rows=[r for r in csv.DictReader(raw.decode().splitlines()) if r['completed']=='TRUE' and r['home_division'] in ['fbs','fcs'] and r['away_division'] in ['fbs','fcs'] and r['home_points'].isdigit() and r['away_points'].isdigit() and r['home_points']!=r['away_points']];rows.sort(key=lambda r:int(r['game_id']));teams={int(r[s+'_id']):r[s+'_division'] for r in rows for s in ['home','away']};ids=sorted(teams);ix={id:i for i,id in enumerate(ids)};n=len(ids)
 h=np.array([ix[int(r['home_id'])] for r in rows]);a=np.array([ix[int(r['away_id'])] for r in rows]);m=np.array([int(r['home_points'])-int(r['away_points']) for r in rows],float);x=np.array([r['neutral_site']!='TRUE' for r in rows],float);times=np.array([datetime.fromisoformat(r['start_date'].replace('Z','+00:00')).timestamp() for r in rows]);fbs=np.array([teams[id]=='fbs' for id in ids]);cutoffs=EPOCH+np.floor((times-EPOCH)/604800)*604800
 return dict(year=year,sha256=hashlib.sha256(raw).hexdigest(),n=n,h=h,a=a,m=m,x=x,time=times,cutoff=cutoffs,fbs=fbs)
def fit(S,indices,shrink,hridge,means=None,hprior=0):
 n=S['n'];h=S['h'][indices];a=S['a'][indices];x=S['x'][indices];y=S['m'][indices]+3*np.sign(S['m'][indices]);A=np.diag(np.r_[np.full(n,shrink),hridge]);b=np.r_[np.zeros(n) if means is None else shrink*means,hridge*hprior]
 np.add.at(A,(h,h),1);np.add.at(A,(a,a),1);np.add.at(A,(h,a),-1);np.add.at(A,(a,h),-1);np.add.at(A,(h,n),x);np.add.at(A,(a,n),-x);A[n,:n]=A[:n,n];A[n,n]+=x.sum();np.add.at(b,h,y);np.add.at(b,a,-y);b[n]+=(x*y).sum();fac=cho_factor(A,lower=True);r=cho_solve(fac,b);inv=cho_solve(fac,np.eye(n+1));return r,inv
def design():
    inputs=[load(y) for y in range(2014,2020)];gap_rows=[]
    for S in inputs:
     r,inv=fit(S,np.arange(len(S['h'])),.05,.0001);gap_rows.append(dict(year=S['year'],gap=float(r[:S['n']][S['fbs']].mean()-r[:S['n']][~S['fbs']].mean()),home=float(r[-1]),spread=float(np.std(r[:S['n']]-np.where(S['fbs'],r[:S['n']][S['fbs']].mean(),r[:S['n']][~S['fbs']].mean())))))
    gap=round(np.mean([r['gap'] for r in gap_rows]),6);home=round(np.mean([r['home'] for r in gap_rows]),6)
    print(json.dumps(dict(empiricalDivisionGap=gap,empiricalHomeField=home,perYear=gap_rows)),flush=True)
    candidates=[]
    for shrink in [.25,.5,1.,2.,4.]:
     for hridge in [1.,4.,16.,64.]:
      loss=brier=0.;nobs=0;ledgers=[]
      for S in inputs:
       n=S['n'];prior=np.where(S['fbs'],0.,-gap);prior-=prior.mean();earned=np.zeros(n);losses=np.zeros(n)
       c=np.zeros(n+1);c[:n][S['fbs']]=1/S['fbs'].sum()
       for cutoff in sorted(set(S['cutoff'])):
        tr=np.flatnonzero(S['time']+21600<=cutoff);test=np.flatnonzero(S['cutoff']==cutoff);r,inv=fit(S,tr,shrink,hridge,prior,home)
        if len(tr):
         h=S['h'][test];a=S['a'][test];x=S['x'][test];edge=r[h]-r[a]+x*r[n];v=(inv[h,h]+inv[a,a]-2*inv[h,a]+x*x*inv[n,n]+2*x*(inv[h,n]-inv[a,n]))*SIGMA**2;p=1/(1+np.exp(np.clip(-edge/np.sqrt(SCALE*SCALE+3*v/np.pi**2),-40,40)));y=(S['m'][test]>0).astype(float);loss+=float((-y*np.log(p)-(1-y)*np.log(1-p)).sum());brier+=float(((p-y)**2).sum());nobs+=len(test)
        ref=float(c@r);cov=inv@c;rv=float(c@cov)
        for g in test:
         w,l=(S['h'][g],S['a'][g]) if S['m'][g]>0 else (S['a'][g],S['h'][g]);site=S['x'][g]*(1 if w==S['h'][g] else -1);v=(inv[l,l]+site*site*inv[n,n]-2*site*inv[l,n]+rv-2*cov[l]+2*site*cov[n])*SIGMA**2;edge=r[l]-ref-site*r[n];q=1/(1+np.exp(np.clip(-edge/np.sqrt(SCALE*SCALE+3*max(0,v)/np.pi**2),-40,40)));earned[w]+=q;losses[l]+=1
       ledgers.append((S,earned,losses))
      row=dict(shrink=shrink,homeFieldShrink=hridge,logLoss=loss/nobs,brier=brier/nobs,n=nobs)
      candidates.append((row,ledgers));print(json.dumps(row),flush=True)
    best,ledgers=min(candidates,key=lambda r:(r[0]['logLoss'],r[0]['shrink'],r[0]['homeFieldShrink']))
    scale_rows=[]
    for scale in [.5,1.,1.5,2.,3.,4.,6.,8.]:
     counts={k:[0.,0] for k in ['all','fbs','cross','fcs']}
     for S,earned,losses in ledgers:
      scores=np.round(scale*earned-losses,6);h=S['h'];a=S['a'];w=np.where(S['m']>0,h,a);l=np.where(S['m']>0,a,h);agree=np.where(scores[w]>scores[l],1.,np.where(scores[w]==scores[l],.5,0.));masks={'all':np.ones(len(h),bool),'fbs':S['fbs'][h]&S['fbs'][a],'cross':S['fbs'][h]!=S['fbs'][a],'fcs':~S['fbs'][h]&~S['fbs'][a]}
      for k,mask in masks.items():counts[k][0]+=agree[mask].sum();counts[k][1]+=mask.sum()
     scale_rows.append(dict(winScale=scale,agreement={k:dict(rate=a/n,games=int(n)) for k,(a,n) in counts.items()}))
    # Average-quality neutral-site win = +1, fixed loss = -1. Scale sensitivity is
    # descriptive only; optimizing it would keep reducing the effect of losses.
    selected_scale=next(r for r in scale_rows if r['winScale']==2.)
    report=dict(id='win-quality-fbs-reference-2014-2019-v2',status='training design: pooled priors are estimated from the full design window, then fixed across pre-week fits; later/current seasons are development only',sourceRevision=REV,years=list(range(2014,2020)),inputs=[dict(year=S['year'],sha256=S['sha256']) for S in inputs],priors=dict(divisionGap=gap,homeField=home,perYear=gap_rows),selection='Minimum pooled pre-week game log loss on design seasons for quality regularization. A policy scale of 2 balances an average-quality neutral-site win (+1) with the fixed loss deduction (-1); scale sensitivity is not used for selection. No team or conference settings.',probabilityScale=SCALE,residualScale=SIGMA,policy=dict(lossPenalty=1,averageFbsNeutralWin=1,maximumWin=2,noDivisionRankCap=True),selected=dict(reference='fbs',divisionGap=gap,homeField=home,**{k:v for k,v in best.items() if k in ['shrink','homeFieldShrink']},winScale=selected_scale['winScale'],calibrationId='win-quality-fbs-reference-2014-2019-v2'),strengthCandidates=[c[0] for c in candidates],winScaleCandidates=scale_rows)
    Path(__file__).with_name('win-quality-calibration.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(dict(selected=report['selected'],strengthValidation=best,scaleCandidates=scale_rows)),flush=True)

if __name__ == "__main__":
    design()
