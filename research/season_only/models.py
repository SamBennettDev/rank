"""Equal-start ranking methods; fits receive only games before the forecast cutoff."""
from dataclasses import dataclass, field
import numpy as np
from scipy.linalg import cho_factor, cho_solve
from scipy.special import expit

def solve(a,b):
    return cho_solve(cho_factor(a,check_finite=False), b,check_finite=False)

def lap(n,h,a,w):
    L=np.zeros((n,n))
    for i,j,x in [(h,h,w),(a,a,w),(h,a,-w),(a,h,-w)]: np.add.at(L,(i,j),x)
    return L

def rating(s, idx, ridge=1., cap=0., bonus=0., half=0., huber=0., win_only=False, spring=False):
    g=s.games.iloc[idx]; n=s.n
    if not len(g): return np.zeros(n), 0., np.ones(n)/ridge
    h=g.h.to_numpy(); a=g.a.to_numpy(); v=g.venue.to_numpy(); y=g.margin.to_numpy(float)
    if cap: y=np.clip(y,-cap,cap)
    if win_only: y=np.sign(y)*7
    y += bonus*np.sign(y)
    w=np.ones(len(g))
    if spring: w=np.abs(g.margin.to_numpy())
    if half: w*=2**((g.time.to_numpy()-g.time.max())/(half*86400))
    def fit(w):
        A=np.zeros((n+1,n+1)); A[:n,:n]=lap(n,h,a,w)+np.eye(n)*ridge
        cross=np.bincount(h,w*v,n)-np.bincount(a,w*v,n)
        A[:n,n]=cross; A[n,:n]=cross; A[n,n]=(w*v*v).sum()+4.
        b=np.r_[np.bincount(h,w*y,n)-np.bincount(a,w*y,n),(w*v*y).sum()]
        return solve(A,b), A
    r,A=fit(w)
    if huber:
        for _ in range(12):
            resid=y-(r[h]-r[a]+r[n]*v)
            nxt,A=fit(w*np.minimum(1,huber/np.maximum(np.abs(resid),1e-8)))
            if np.max(np.abs(nxt-r))<1e-5: r=nxt; break
            r=nxt
    # Diagonal precision proxy is used as an evidence measure, not reported as a posterior CI.
    return r[:n],r[n],1/np.diag(A)[:n]

def od(s,idx,metric='score',ridge=180.,all_plays=False):
    n=s.n; g=s.games.iloc[idx]
    if metric=='score':
        t=np.r_[g.h,g.a].astype(int); u=np.r_[g.a,g.h].astype(int)
        y=np.r_[g.home_points,g.away_points].astype(float)
        site=np.r_[g.venue,-g.venue]; w=np.ones(len(t)); ridge=ridge/180
    else:
        p=s.plays[s.plays.game_id.isin(g.game_id)]
        count='all_snaps' if all_plays else 'snaps'
        value=('all_' if all_plays else '')+('epa' if metric=='epa' else 'success')
        p=p[p[count]>0]; t=p.t.to_numpy(); u=p.u.to_numpy(); site=p.site.to_numpy()
        w=p[count].to_numpy(float); y=p[value].to_numpy(float)/w
    N=2*n+2; A=np.eye(N)*ridge; A[2*n:,2*n:]=np.eye(2)*1e-4
    b=np.zeros(N)
    if not len(t): return np.zeros(n),np.zeros(n),np.zeros(n),np.zeros(n)
    columns=[t,n+u,np.full(len(t),2*n),np.full(len(t),2*n+1)]
    values=[np.ones(len(t)),-np.ones(len(t)),np.ones(len(t)),site]
    for i,x in zip(columns,values):
        np.add.at(b,i,w*y*x)
        for j,z in zip(columns,values): np.add.at(A,(i,j),w*x*z)
    r=solve(A,b)
    counts=np.bincount(t,w,n)+np.bincount(u,w,n)
    return r[:n],r[n:2*n],counts,r[2*n:]

def special(s,idx,ridge=4):
    p=s.plays[s.plays.game_id.isin(s.games.iloc[idx].game_id)].drop_duplicates('game_id')
    t=p.t.to_numpy();u=p.u.to_numpy();y=p.special_epa.to_numpy(float)
    b=np.bincount(t,y,s.n)-np.bincount(u,y,s.n)
    return solve(lap(s.n,t,u,np.ones(len(t)))+np.eye(s.n)*ridge,b)

def bt(s,idx,ridge=1.):
    g=s.games.iloc[idx];h=g.h.to_numpy();a=g.a.to_numpy();v=g.venue.to_numpy();y=(g.margin>0).to_numpy(float); n=s.n
    r=np.zeros(n+1)
    for _ in range(25):
        p=expit(r[h]-r[a]+r[n]*v);w=p*(1-p)
        A=np.zeros((n+1,n+1));A[:n,:n]=lap(n,h,a,w)+np.eye(n)*ridge
        cross=np.bincount(h,w*v,n)-np.bincount(a,w*v,n)
        A[:n,n]=cross;A[n,:n]=cross;A[n,n]=(w*v*v).sum()+1
        b=-np.r_[np.full(n,ridge),1]*r
        b[:n]+=np.bincount(h,y-p,n)-np.bincount(a,y-p,n);b[n]+=((y-p)*v).sum()
        step=solve(A,b);r+=step
        if np.max(np.abs(step))<1e-6:break
    return r[:n]

@dataclass(frozen=True)
class Method:
    family: str
    params: tuple=field(default_factory=tuple)
    @property
    def name(self): return self.family + (':' + ','.join(f'{k}={v}' for k,v in self.params) if self.params else '')
    def fit(self,s,idx,cache):
        key=self.name
        if key in cache:return cache[key]
        p=dict(self.params);g=s.games.iloc[idx];n=s.n;h=g.h.to_numpy();a=g.a.to_numpy();m=g.margin.to_numpy(float)
        w=np.where(m>0,h,a);l=np.where(m>0,a,h)
        wins=np.bincount(w,minlength=n);losses=np.bincount(l,minlength=n);ng=wins+losses
        if self.family=='win_percentage':r=(wins+.5)/(ng+1)-.5
        elif self.family=='net_wins':r=wins-losses
        elif self.family=='pythagorean':
            pf=np.bincount(h,g.home_points,n)+np.bincount(a,g.away_points,n)
            pa=np.bincount(h,g.away_points,n)+np.bincount(a,g.home_points,n)
            r=(pf+1)**p.get('exponent',2.37)/((pf+1)**p.get('exponent',2.37)+(pa+1)**p.get('exponent',2.37))-.5
        elif self.family=='colley':r=solve(lap(n,h,a,np.ones(len(g)))+2*np.eye(n),1+(wins-losses)/2)-.5
        elif self.family=='bradley_terry':r=bt(s,idx,**p)
        elif self.family in ['massey','capped_margin','robust_margin','recency_margin','win_springs','margin_springs']:
            r=rating(s,idx,**p)[0]
        elif self.family=='elo':
            r=np.zeros(n);k=p.get('k',40);mov=p.get('mov',False)
            current_hfa=rating(s,idx)[1]*25
            for row in g.itertuples():
                d=r[row.h]-r[row.a]+row.venue*current_hfa
                e=expit(d*np.log(10)/400)
                mul=np.log1p(abs(row.margin)) if mov else 1
                delta=k*mul*((row.margin>0)-e);r[row.h]+=delta;r[row.a]-=delta
            r/=25
        elif self.family=='offense_defense_score':
            o,d,_,_=od(s,idx,metric='score',ridge=p['ridge']*180);r=o+d
        elif self.family in ['epa_units','success_units','epa_margin','success_margin','epa_success','evidence_blend']:
            metric='success' if self.family in ['success_units','success_margin'] else 'epa'
            ridge=p.get('ridge',180)
            ukey=f'unit:{metric}:{ridge}:{p.get("all_plays",False)}'
            if ukey not in cache:cache[ukey]=od(s,idx,metric,ridge,p.get('all_plays',False))
            o,d,c,_=cache[ukey];factor=100 if metric=='success' else 60
            unit=(o+d)*factor
            score=Method('massey',(('ridge',1.),)).fit(s,idx,cache)
            if self.family in ['epa_units','success_units']:r=np.where(c>0,unit,score)
            elif self.family=='epa_success':
                so,sd,sc,_=od(s,idx,'success',ridge);alpha=p['alpha']
                r=np.where(c>0,alpha*unit+(1-alpha)*100*(so+sd),score)
            elif self.family=='evidence_blend':
                so,sd,sc,_=od(s,idx,'success',ridge)
                st=special(s,idx)
                # Current-season sample sizes and signal disagreement modulate blending.
                unit=.5*unit+.5*100*(so+sd)+p.get('st',0)*st
                reliability=(c/(c+p['snaps']))/(1+np.abs(unit-score)/p['disagreement'])
                alpha=p['alpha']*reliability
                r=(1-alpha)*score+alpha*unit
            else:r=np.where(c>0,(1-p['alpha'])*score+p['alpha']*unit,score)
        elif self.family=='pagerank':
            M=np.zeros((n,n));np.add.at(M,(l,w),np.abs(m) if p.get('margin') else 1)
            out=M.sum(1);M[out==0]=1/n;M[out>0]/=out[out>0,None]
            r=np.ones(n)/n;d=p.get('damping',.85)
            for _ in range(400):
                nr=(1-d)/n+d*r@M
                if np.max(np.abs(nr-r))<1e-12:r=nr;break
                r=nr
            r=np.log(np.maximum(r,1e-12))
        elif self.family=='keener':
            scores=np.zeros((n,n));counts=np.zeros((n,n))
            np.add.at(scores,(h,a),g.home_points);np.add.at(scores,(a,h),g.away_points)
            np.add.at(counts,(h,a),1);np.add.at(counts,(a,h),1)
            # Per-opponent mean scores; degree normalizes rows once, not every iteration.
            avg=scores/np.maximum(counts,1)
            share=(avg+1)/(avg+avg.T+2)
            A=np.where(counts>0,.5+.5*np.sign(share-.5)*np.sqrt(np.abs(2*share-1)),0)
            A*=counts
            A/=np.maximum(counts.sum(1),1)[:,None];A+=p.get('epsilon',.001)/n
            r=np.ones(n)/n
            for _ in range(1000):
                nr=A@r;nr/=nr.sum()
                if np.max(np.abs(nr-r))<1e-12:r=nr;break
                r=nr
            r=np.log(np.maximum(r,1e-12))
        elif self.family=='lrmc':
            home_hfa=rating(s,idx)[1];prob=expit((m-g.venue*home_hfa)*p.get('scale',.08))
            M=np.zeros((n,n))
            for i,j,z in [(h,a,1-prob),(h,h,prob),(a,h,prob),(a,a,1-prob)]:np.add.at(M,(i,j),z)
            deg=M.sum(1);M[deg==0,np.arange(n)[deg==0]]=1;M/=M.sum(1)[:,None]
            M=.99*M+.01/n;r=np.ones(n)/n
            for _ in range(1000):
                nr=r@M
                if np.max(np.abs(nr-r))<1e-12:r=nr;break
                r=nr
            r=np.log(np.maximum(r,1e-12))
        else:raise ValueError(self.family)
        assert np.isfinite(r).all(),self.name
        cache[key]=np.asarray(r)
        return cache[key]

def method(family,**params):return Method(family,tuple(sorted(params.items())))

def candidates():
    m=[method('win_percentage'),method('net_wins'),method('colley')]
    m += [method('pythagorean',exponent=e) for e in [1.5,2.0,2.37,3.0]]
    m += [method('bradley_terry',ridge=r) for r in [.1,.3,1.,3.]]
    m += [method('massey',ridge=r,bonus=b) for r in [.05,.25,1.,4.] for b in [0.,3.,7.]]
    m += [method('capped_margin',ridge=r,cap=c) for r in [.25,1.,4.] for c in [14.,21.,28.,35.,50.]]
    m += [method('robust_margin',ridge=r,huber=h) for r in [.25,1.,4.] for h in [7.,14.,21.]]
    m += [method('recency_margin',ridge=r,half=h,cap=35.) for r in [.25,1.,4.] for h in [14.,28.,56.,112.]]
    m += [method('win_springs',ridge=r,win_only=True) for r in [.05,1.,4.]]
    m += [method('margin_springs',ridge=r,win_only=True,spring=True) for r in [1.,10.,50.]]
    m += [method('elo',k=k,mov=mov) for k in [20,40,80,160] for mov in [False,True]]
    m += [method('offense_defense_score',ridge=r) for r in [.25,1.,4.]]
    m += [method('pagerank',damping=d,margin=marg) for d in [.5,.75,.9] for marg in [False,True]]
    m += [method('keener',epsilon=e) for e in [.001,.01,.1]]
    m += [method('lrmc',scale=z) for z in [.04,.08,.16]]
    for family in ['epa_units','success_units']:
        m += [method(family,ridge=r,all_plays=all_p) for r in [60.,180.,400.] for all_p in [False,True]]
    for family in ['epa_margin','success_margin','epa_success']:
        m += [method(family,ridge=r,alpha=a) for r in [60.,180.,400.] for a in [.25,.5,.75]]
    m += [method('evidence_blend',ridge=180.,alpha=a,snaps=n,disagreement=d,st=st)
          for a in [.5,1.] for n in [100.,400.] for d in [10.,30.,1000.] for st in [0.,.5]]
    return m
