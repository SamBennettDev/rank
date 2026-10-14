"""Same-input frozen-credit v2 comparison. No candidate selection."""
import json
import sys
import numpy as np
from study import HERE, ROOT, load, agreement
sys.path.insert(0,str(ROOT/'research'))
from win_quality import fit, SIGMA, SCALE


def legacy(s,g):
    n=s['n']; modeled=g[(g.h>=0)&(g.a>=0)]
    h,a=modeled.h.to_numpy(),modeled.a.to_numpy()
    S=dict(n=n,h=h,a=a,m=(modeled.home_points-modeled.away_points).to_numpy(),x=modeled.site.to_numpy())
    q=json.loads((ROOT/'research/win-quality-calibration.json').read_text())['selected']
    prior=np.where(s['fbs'],0.,-q['divisionGap']);prior-=prior.mean()
    ref=np.r_[s['fbs']/s['fbs'].sum(),0.]
    score=np.zeros(n)
    for cutoff in sorted(modeled.batch.unique()):
        train=np.flatnonzero(modeled.time.to_numpy()+21600<=cutoff)
        test=np.flatnonzero(modeled.batch.to_numpy()==cutoff)
        r,inv=fit(S,train,q['shrink'],q['homeFieldShrink'],prior,q['homeField'])
        benchmark=ref@r;cov=inv@ref;rv=ref@cov
        for j in test:
            w,l=(h[j],a[j]) if S['m'][j]>0 else (a[j],h[j])
            site=S['x'][j]*(1 if w==h[j] else -1)
            variance=(inv[l,l]+site*site*inv[n,n]-2*site*inv[l,n]+rv-2*cov[l]+2*site*cov[n])*SIGMA**2
            edge=r[l]-benchmark-site*r[n]
            probability=1/(1+np.exp(-edge/np.sqrt(SCALE*SCALE+3*max(0,variance)/np.pi**2)))
            score[w]+=2*round(float(probability),6);score[l]-=1
    for game in g[(g.h<0)|(g.a<0)].itertuples():
        loser=game.a if game.y else game.h
        if loser>=0:score[loser]-=1
    return score


def main():
    path=HERE/'evaluation.json';report=json.loads(path.read_text())
    report['standings']=[r for r in report['standings'] if r['method']!='Previous frozen-credit v2']
    for year in range(2002,2026):
        s=load(year);g=s['g'];through=g[(g.season_type=='regular')&(g.week<=6)]
        cutoff=float((through.time+21600).max())
        for snapshot,subset in [('week6',g[g.time+21600<=cutoff]),('final',g)]:
            scores=legacy(s,subset);modeled=subset[(subset.h>=0)&(subset.a>=0)]
            report['standings'].append(dict(year=year,snapshot=snapshot,method='Previous frozen-credit v2',agreement=agreement(s,modeled,scores)))
        print('legacy',year,flush=True)
    report['legacyPolicy']='Original 2014–2019 FBS/FCS division prior is replayed on all seasons. On 2002–2013 this uses later policy calibration and is descriptive, not a historical as-issued or out-of-sample forecast.'
    path.write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
