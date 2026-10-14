"""Common evaluation: probability quality, accuracy, and margin error."""
import numpy as np
from scipy.special import expit
from scipy.optimize import minimize

def metrics(y,p,margin=None,pred_margin=None):
    y=np.asarray(y);p=np.clip(np.asarray(p),1e-7,1-1e-7)
    hit=np.where(np.abs(p-.5)<1e-12,.5,(p>.5)==(y>0))
    result=dict(games=len(y),accuracy=float(hit.mean()),brier=float(np.mean((p-y)**2)),
        log_loss=float(-np.mean(y*np.log(p)+(1-y)*np.log1p(-p))))
    if margin is not None and pred_margin is not None:
        result['margin_rmse']=float(np.sqrt(np.mean((np.asarray(margin)-pred_margin)**2)))
        result['margin_mae']=float(np.mean(np.abs(np.asarray(margin)-pred_margin)))
    return result

def calibrate(edge,venue,y,margin):
    X=np.c_[edge,venue]
    def obj(t):
        z=X@t
        return np.mean(np.logaddexp(0,z)-y*z)+1e-6*np.dot(t,t),X.T@(expit(z)-y)/len(y)+2e-6*t
    fit=minimize(obj,[.1,.1],method='L-BFGS-B',jac=True,bounds=[(1e-8,None),(0,None)])
    coef=np.linalg.lstsq(X,np.asarray(margin),rcond=None)[0]
    return fit.x,coef

def paired(y,p,q,years):
    """Season-block bootstrap; preserves within-season dependence, small block count disclosed."""
    y=np.asarray(y);p=np.clip(p,1e-7,1-1e-7);q=np.clip(q,1e-7,1-1e-7)
    hit=lambda z:np.where(np.abs(z-.5)<1e-12,.5,(z>.5)==(y>0))
    loss=lambda z:-(y*np.log(z)+(1-y)*np.log1p(-z))
    delta=np.c_[hit(p)-hit(q),loss(p)-loss(q)]
    unique=np.unique(years);groups=[delta[np.asarray(years)==yr] for yr in unique]
    sums=np.array([x.sum(0) for x in groups]);counts=np.array([len(x) for x in groups])
    rng=np.random.default_rng(20261013);sample=rng.integers(0,len(groups),size=(20000,len(groups)))
    bs=sums[sample].sum(1)/counts[sample].sum(1)[:,None]
    lo,hi=np.quantile(bs,[.025,.975],axis=0)
    return dict(games=len(y),seasons=len(unique),accuracy_difference=float(delta[:,0].mean()),
        accuracy_95_interval=[float(lo[0]),float(hi[0])],log_loss_difference=float(delta[:,1].mean()),
        log_loss_95_interval=[float(lo[1]),float(hi[1])])
