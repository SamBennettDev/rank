"""Bounded neural residual around a robust schedule rating; losses applied after fit."""
from dataclasses import dataclass
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit


@dataclass
class BoundedRanker:
    ridge: float
    evidence_prior: float
    residual_limit: float
    anchor_scale: float
    seed: int
    scale: np.ndarray
    width: int = 8
    loss_penalty: float = 0.
    loss_prior: float = 4.
    clip: float = 4.
    theta: np.ndarray = None
    iterations: int = 0
    converged: bool = False

    def unpack(self, theta):
        d,k=len(self.scale),self.width
        return theta[:d],theta[d:d+d*k].reshape(d,k),theta[d+d*k:d+d*k+k],theta[d+d*k+k:d+d*k+2*k],theta[-1]

    def strength(self,x,games,losses):
        z=np.clip(x/self.scale,-self.clip,self.clip)
        linear,W,b,out,_=self.unpack(self.theta)
        residual=self.residual_limit*np.tanh(z@linear+np.tanh(z@W+b)@out)
        return games/(games+self.evidence_prior)*(x[:,1]/self.anchor_scale+residual)-self.loss_penalty*losses/(games+self.loss_prior)

    def logits(self,h,a,hg,ag,hl,al,venue):
        return self.strength(h,hg,hl)-self.strength(a,ag,al)+self.theta[-1]*venue

    def fit(self,h,a,hg,ag,hl,al,venue,y,weights,maxiter=300):
        assert self.loss_penalty==0,'Fit performance first; loss policy is selected afterwards.'
        n,d,k=len(y),len(self.scale),self.width
        raw=np.r_[h,a];x=np.clip(raw/self.scale,-self.clip,self.clip)
        rel=np.r_[hg/(hg+self.evidence_prior),ag/(ag+self.evidence_prior)]
        anchor=raw[:,1]/self.anchor_scale;sign=np.r_[np.ones(n),-np.ones(n)]
        weights=weights/weights.sum();rng=np.random.default_rng(self.seed)
        initial=np.r_[np.zeros(d),rng.normal(0,.08,(d,k)).ravel(),np.zeros(k),rng.normal(0,.03,k),.3]
        penalty=np.ones(len(initial));penalty[d+d*k:d+d*k+k]=0;penalty[-1]=.1
        def objective(t):
            linear,W,b,out,home=self.unpack(t);hidden=np.tanh(x@W+b)
            residual=np.tanh(x@linear+hidden@out)
            scores=rel*(anchor+self.residual_limit*residual)
            z=scores[:n]-scores[n:]+home*venue
            loss=np.sum(weights*(np.logaddexp(0,z)-y*z))+self.ridge*.5*np.sum(penalty*t*t)
            dz=weights*(expit(z)-y)
            ds=np.r_[dz,dz]*sign*rel*self.residual_limit*(1-residual**2)
            gh=ds[:,None]*out*(1-hidden**2)
            gradient=np.r_[x.T@ds,(x.T@gh).ravel(),gh.sum(0),hidden.T@ds,dz@venue]
            return loss,gradient+self.ridge*penalty*t
        self.objective_for_check=objective
        result=minimize(objective,initial,jac=True,method='L-BFGS-B',options=dict(maxiter=maxiter,ftol=1e-9,gtol=1e-6,maxls=30))
        self.theta=result.x;self.iterations=result.nit;self.converged=bool(result.success)
        assert np.isfinite(self.theta).all()
        return self

    def asdict(self):
        return dict(ridge=self.ridge,evidence_prior=self.evidence_prior,residual_limit=self.residual_limit,
            anchor_scale=self.anchor_scale,seed=self.seed,scale=self.scale.tolist(),width=self.width,
            loss_penalty=self.loss_penalty,loss_prior=self.loss_prior,clip=self.clip,
            theta=self.theta.tolist(),iterations=self.iterations,converged=self.converged)

    @classmethod
    def fromdict(cls,obj):
        obj=dict(obj);obj['scale']=np.array(obj['scale']);obj['theta']=np.array(obj['theta'])
        return cls(**obj)


def probability(model,**x):
    return expit(np.mean([BoundedRanker.fromdict(m).logits(**x)for m in model['models']],axis=0))
