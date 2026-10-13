"""Compare result-ranking methods under a strict fixed-loss-deduction requirement.
Design years only; current-standing consistency is descriptive, not predictive proof.
"""
import csv,json,hashlib
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from scipy.linalg import cho_factor,cho_solve
import models

REV='a3dd960090c1bfa169cebd491beabf7028b379b2'
SIGMA=14.934045; SCALE=12.; SHRINK=.05
def load(year):
    path=Path(f'/tmp/rank-backtest/cfb_schedules_{REV}_{year}.csv')
    rows=[r for r in csv.DictReader(path.open()) if r['completed']=='TRUE' and r['home_division'] in ('fbs','fcs') and r['away_division'] in ('fbs','fcs') and r['home_points'].isdigit() and r['away_points'].isdigit() and r['home_points']!=r['away_points']]
    rows.sort(key=lambda r:int(r['game_id']))
    ids=sorted({int(r[s+'_id']) for r in rows for s in ('home','away')});ix={t:i for i,t in enumerate(ids)}
    from datetime import datetime,timezone
    epoch=datetime(1970,1,5,12,tzinfo=timezone.utc).timestamp()
    times=np.array([datetime.fromisoformat(r['start_date'].replace('Z','+00:00')).timestamp() for r in rows])
    return SimpleNamespace(n=len(ids),ids=ids,gid=np.array([int(r['game_id']) for r in rows]),home=np.array([ix[int(r['home_id'])] for r in rows]),away=np.array([ix[int(r['away_id'])] for r in rows]),hp=np.array([float(r['home_points']) for r in rows]),ap=np.array([float(r['away_points']) for r in rows]),neutral=np.array([r['neutral_site']=='TRUE' for r in rows]),cutoff=epoch+np.floor((times-epoch)/604800)*604800,time=times)
def power(S,idx):
    n=S.n;h=S.home[idx];a=S.away[idx];x=(~S.neutral[idx]).astype(float);m=S.hp[idx]-S.ap[idx];y=m+3*np.sign(m)
    A=np.zeros((n+1,n+1));b=np.zeros(n+1)
    np.add.at(A,(h,h),1);np.add.at(A,(a,a),1);np.add.at(A,(h,a),-1);np.add.at(A,(a,h),-1)
    np.add.at(A,(h,n),x);np.add.at(A,(a,n),-x);A[n,:n]=A[:n,n];A[n,n]=x.sum()+.0001;A[np.arange(n),np.arange(n)]+=SHRINK
    b[:n]=np.bincount(h,y,n)-np.bincount(a,y,n);b[n]=(x*y).sum()
    factor=cho_factor(A,lower=True);r=cho_solve(factor,b);inverse=cho_solve(factor,np.eye(n+1))
    return r,inverse
def quality_ledger(S):
    earned=np.zeros(S.n);wins=np.zeros(S.n);losses=np.zeros(S.n)
    for cutoff in sorted(set(S.cutoff)):
        train=np.flatnonzero(S.time+21600<=cutoff);test=np.flatnonzero(S.cutoff==cutoff)
        r,inv=power(S,train)
        for g in test:
            w,l=(S.home[g],S.away[g]) if S.hp[g]>S.ap[g] else (S.away[g],S.home[g])
            site=0 if S.neutral[g] else (1 if w==S.home[g] else -1)
            v=max(0,SIGMA**2*(inv[l,l]+site*site*inv[S.n,S.n]-2*site*inv[l,S.n]-1/(S.n*SHRINK)))
            scale=np.sqrt(SCALE*SCALE+3*v/np.pi**2)
            pref=1/(1+np.exp(np.clip(-(-r[l]+site*r[S.n])/scale,-40,40)))
            earned[w]+=round(1-pref,6);wins[w]+=1;losses[l]+=1
    return earned,wins,losses
def agreement(S,r):
    r=np.round(r,6);w=np.where(S.hp>S.ap,S.home,S.away);l=np.where(S.hp>S.ap,S.away,S.home)
    return float(np.where(r[w]>r[l],1.,np.where(r[w]==r[l],.5,0.)).sum()),len(w)
def monotonic_examples():
    h=np.array([0]*6+[1]*6);a=np.array(list(range(2,8))*2);hp=np.array([20]*6+[0]*6);ap=np.array([0]*6+[20]*6)
    S=SimpleNamespace(n=8,home=h,away=a,hp=hp,ap=ap,neutral=np.ones(12,bool))
    T=SimpleNamespace(**vars(S));T.home=np.r_[h,0];T.away=np.r_[a,1];T.hp=np.r_[hp,20];T.ap=np.r_[ap,0];T.neutral=np.ones(13,bool)
    return {name:float(fn(T,np.arange(13))[1]-fn(S,np.arange(12))[1]) for name,fn in [('Colley',models.colley),('Bradley–Terry',lambda S,i:models.bradley_terry(S,i,prior=2)),('Elo wins only',lambda S,i:models.elo(S,i,K=40,mov=False))]}
if __name__=='__main__':
    years=list(range(2014,2020));results={};per=[]
    for year in years:
        S=load(year);idx=np.arange(len(S.gid));earned,wins,losses=quality_ledger(S)
        candidates={'Win percentage':models.winpct(S,idx),'Colley':models.colley(S,idx),'Bradley–Terry':models.bradley_terry(S,idx,prior=2),'Elo wins only':models.elo(S,np.lexsort((S.gid,S.time)),K=40,mov=False),'Raw wins minus losses':wins-losses}
        for base,weight in [(0,1),(0,2),(1,.5),(1,1),(1,2)]:
            for ratio in [1,1.5,2]:
                penalty=(base+weight)*ratio
                name=f'earned b={base} q={weight} loss={penalty:g}'
                candidates[name]=base*wins+weight*earned-penalty*losses
        for name,r in candidates.items():
            correct,n=agreement(S,r);old=results.setdefault(name,[0,0]);old[0]+=correct;old[1]+=n;per.append({'year':year,'method':name,'agreement':correct/n,'games':n})
        print(year,flush=True)
    table=[{'method':name,'agreement':a/n,'games':n,'fixedLossDeduction':name.startswith('earned') or name=='Raw wins minus losses'} for name,(a,n) in results.items()]
    table.sort(key=lambda r:-r['agreement'])
    selected=next(r for r in table if r['method'].startswith('earned'))
    report={'status':'training design only; winner-above-loser agreement is descriptive, not a claim of predictive accuracy','years':years,'sourceRevision':REV,'inputs':[{'year':year,'sha256':hashlib.sha256(Path(f'/tmp/rank-backtest/cfb_schedules_{REV}_{year}.csv').read_bytes()).hexdigest()} for year in years],'qualityModel':{'winBonus':3,'shrink':SHRINK,'homeFieldShrink':.0001,'residualScale':SIGMA,'probabilityScale':SCALE,'creditDigits':6},'criterion':'maximize season-end game-result agreement among methods with a fixed loss deduction at least as large as the maximum win credit; win quality is frozen before each calendar week','selected':selected,'methods':table,'lossCounterexample':monotonic_examples(),'perYear':per}
    Path(__file__).with_name('standing-selection.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report['methods'],indent=2));print('loss fixture',report['lossCounterexample']);print('selected',selected)
