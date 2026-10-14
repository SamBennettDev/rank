"""Permutation-invariant rank and antisymmetric matchup networks, trained with NumPy.

There are no embeddings, team IDs, names, conference, division, or preseason inputs.
Historical seasons teach shared weights; each forecast's team statistics reset yearly.
"""
import json
from dataclasses import dataclass
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

@dataclass
class Network:
    kind: str
    width: int
    ridge: float
    auxiliary: float
    seed: int
    scale: np.ndarray
    focus: float = 0.
    theta: np.ndarray = None
    iterations: int = 0
    converged: bool = False

    @property
    def dim(self):return len(self.scale)*(2 if self.kind=='matchup' else 1)
    @property
    def name(self):return f'{self.kind}:width={self.width},ridge={self.ridge},auxiliary={self.auxiliary}'
    def unpack(self,t):
        d=self.dim;k=self.width
        return t[:d],t[d:d+d*k].reshape(d,k),t[d+d*k:d+d*k+k],t[d+d*k+k:d+d*k+2*k],t[-1]

    def inputs(self,h,a):
        h=np.clip(h/self.scale,-8,8);a=np.clip(a/self.scale,-8,8)
        if self.kind=='rank':
            x=np.concatenate([h,a]);sign=np.r_[np.ones(len(h)),-np.ones(len(a))]
            # x[20] is games/(games+4); use raw value before standardization.
            gate=np.r_[h[:,20]*self.scale[20],a[:,20]*self.scale[20]]
        else:
            diff=h-a;context=(h+a)/2
            x=np.r_[np.c_[diff,context],np.c_[-diff,context]]
            sign=np.r_[np.full(len(h),.5),np.full(len(a),-.5)]
            gate=np.ones(2*len(h))
        return x,sign,gate

    def logits(self,h,a,venue):
        x,sign,gate=self.inputs(h,a);linear,W,b,out,home=self.unpack(self.theta)
        hidden=np.tanh(x@W+b)
        scores=x@linear+gate*(hidden@out)
        return sign[:len(h)]*scores[:len(h)]+sign[len(h):]*scores[len(h):]+home*venue

    def fit(self,h,a,venue,y,margin,maxiter=160,sample_weights=None,optimizer_memory=10):
        x,sign,gate=self.inputs(h,a);d=self.dim;k=self.width;N=len(y)
        rng=np.random.default_rng(self.seed)
        initial=np.r_[np.zeros(d),rng.normal(0,.08,(d,k)).ravel(),np.zeros(k),rng.normal(0,.03,k),.15]
        # A season-only margin estimate is a useful initialization, never a carried team prior.
        initial[0]=self.scale[0]/12 * (1 if self.kind=='rank' else 1)
        target=np.clip(margin,-35,35)/12
        weights=np.ones(N)/N if sample_weights is None else np.asarray(sample_weights)/np.sum(sample_weights)
        penalty=np.ones(len(initial));penalty[d+d*k:d+d*k+k]=0;penalty[-1]=.1
        def objective(t):
            linear,W,b,out,home=self.unpack(t)
            hidden=np.tanh(x@W+b);scores=x@linear+gate*(hidden@out)
            z=sign[:N]*scores[:N]+sign[N:]*scores[N:]+home*venue
            bce=np.logaddexp(0,z)-y*z
            if self.focus:
                sign_y=2*y-1;correct=expit(sign_y*z);factor=(1-correct)**self.focus
                loss=np.sum(weights*factor*bce)
                dz=-weights*sign_y*factor*((1-correct)+self.focus*correct*bce)
            else:
                loss=np.sum(weights*bce)
                dz=weights*(expit(z)-y)
            if self.auxiliary:
                residual=z-target
                loss+=self.auxiliary*np.sum(weights*np.where(np.abs(residual)<1,.5*residual**2,np.abs(residual)-.5))
                dz+=self.auxiliary*weights*np.clip(residual,-1,1)
            ds=np.r_[dz,dz]*sign
            gh=(ds*gate)[:,None]*out*(1-hidden**2)
            gradient=np.r_[x.T@ds,(x.T@gh).ravel(),gh.sum(0),hidden.T@(ds*gate),dz@venue]
            loss+=self.ridge*.5*np.sum(penalty*t*t)
            gradient+=self.ridge*penalty*t
            return loss,gradient
        self.objective_for_check=objective
        result=minimize(objective,initial,jac=True,method='L-BFGS-B',options={'maxiter':maxiter,'ftol':1e-9,'gtol':1e-6,'maxls':30,'maxcor':optimizer_memory})
        self.theta=result.x;self.iterations=result.nit;self.converged=bool(result.success)
        assert np.isfinite(self.theta).all()
        return self

    def team_scores(self,x):
        if self.kind!='rank':raise ValueError('Matchup networks rank by round-robin expected wins.')
        z=np.clip(x/self.scale,-8,8);linear,W,b,out,_=self.unpack(self.theta)
        gate=z[:,20]*self.scale[20]
        return z@linear+gate*(np.tanh(z@W+b)@out)

    def asdict(self):
        return dict(kind=self.kind,width=self.width,ridge=self.ridge,auxiliary=self.auxiliary,seed=self.seed,
                    scale=self.scale.tolist(),theta=self.theta.tolist(),iterations=self.iterations,converged=self.converged,focus=self.focus)

    @classmethod
    def fromdict(cls,d):
        d=dict(d);d['scale']=np.array(d['scale']);d['theta']=np.array(d['theta']);return cls(**d)

def settings():
    return [dict(kind=k,width=w,ridge=r,auxiliary=a) for k in ['rank','matchup'] for w in [4,8,16,32]
            for r in [.0003,.003,.03,.3] for a in [0.,.03]]
