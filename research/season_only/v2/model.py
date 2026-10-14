"""A symmetric mixture of season-wide and small-sample neural experts."""
import gzip
import json
import numpy as np
import pandas as pd
from scipy.special import expit
from common import CACHE, OUT
from build import CACHE as OLD_CACHE
from rich_build import RICH_CACHE, RICH_NAMES
from graph_build import GRAPH_CACHE, GRAPH_NAMES
from neural import Network
from evaluate import calibrate, metrics
from context_features import ADDON_NAMES

FEATURE_SETS = ['rich','context','full','graph_context']

class EvidenceNetwork(Network):
    """Keep the bounded game-count gate independent of standardized-input clipping."""
    def inputs(self,h,a):
        x,sign,gate=super().inputs(h,a)
        if self.kind=='rank':gate=np.r_[np.clip(h[:,20],0,1),np.clip(a[:,20],0,1)]
        return x,sign,gate

    def team_scores(self,x):
        if self.kind!='rank':raise ValueError('Only a rank network has a scalar team score')
        z=np.clip(x/self.scale,-8,8);linear,W,b,out,_=self.unpack(self.theta)
        return z@linear+np.clip(x[:,20],0,1)*(np.tanh(z@W+b)@out)

def feature_names(kind):
    if kind=='rich': return RICH_NAMES
    if kind=='context': return RICH_NAMES+ADDON_NAMES[:48]
    if kind=='full': return RICH_NAMES+ADDON_NAMES
    if kind=='graph_context': return GRAPH_NAMES+ADDON_NAMES
    raise ValueError(kind)

def combine(rich,graph,extra,kind):
    if kind=='rich': return rich
    if kind=='context': return np.c_[rich,extra[:,:48]]
    if kind=='full': return np.c_[rich,extra]
    if kind=='graph_context': return np.c_[graph,extra]
    raise ValueError(kind)

def read_years(years,kind):
    meta=[];h=[];a=[]
    for yr in years:
        m=pd.read_csv(OLD_CACHE/f'{yr}.csv');mask=(m['mode']=='weekly')&m.fbs
        r=np.load(RICH_CACHE/f'{yr}.npz');g=np.load(GRAPH_CACHE/f'{yr}.npz');x=np.load(CACHE/f'{yr}.npz')
        meta.append(m[mask]);h.append(combine(r['xh'][mask],g['xh'][mask],x['xh'][mask],kind))
        a.append(combine(r['xa'][mask],g['xa'][mask],x['xa'][mask],kind))
    return pd.concat(meta,ignore_index=True),np.concatenate(h),np.concatenate(a)

def game_counts(x):
    evidence=np.clip(x[:,20],0,1-1e-8)
    return 4*evidence/(1-evidence)

def early_gate(h,a):
    # Depend only on sample size; complement symmetry survives exchanging teams.
    n=np.minimum(game_counts(h),game_counts(a))
    return expit((5-n)/1.5)

def train(meta,h,a,cfg,seeds=(7,19,43)):
    scale=np.maximum(np.std(np.r_[h,a],axis=0),.01)
    weights=2**((meta.year.to_numpy()-meta.year.max())/4)
    gate=early_gate(h,a);experts={}
    for name,focus in [('global',np.ones(len(meta))),('early',.1+.9*gate)]:
        models=[];z=[]
        for seed in seeds:
            net=EvidenceNetwork(kind=cfg['kind'],width=cfg['width'],ridge=cfg['ridge'],auxiliary=.03,
                        seed=seed,scale=scale).fit(h,a,meta.venue.to_numpy(),meta.y.to_numpy(),
                        meta.margin.to_numpy(),maxiter=350,sample_weights=weights*focus)
            models.append(net.asdict());z.append(net.logits(h,a,meta.venue.to_numpy()))
        temperature,_=calibrate(np.mean(z,axis=0),np.zeros(len(meta)),meta.y.to_numpy(),meta.margin.to_numpy())
        experts[name]=dict(models=models,temperature=float(temperature[0]))
    return dict(settings=cfg,training_years=sorted(meta.year.unique().astype(int).tolist()),
                training_games=len(meta),experts=experts)

def probabilities(obj,h,a,venue):
    result={}
    for name,expert in obj['experts'].items():
        z=np.mean([EvidenceNetwork.fromdict(m).logits(h,a,venue) for m in expert['models']],axis=0)
        result[name]=expit(z*expert['temperature'])
    return result

def predict(obj,h,a,venue,alpha=None):
    p=probabilities(obj,h,a,venue)
    if alpha is None: alpha=obj['alpha']
    weight=alpha*early_gate(h,a)
    return (1-weight)*p['global']+weight*p['early']

def save_model(path,obj):
    with gzip.open(path,'wt') as f: json.dump(obj,f,separators=(',',':'))

def load_model(path):
    with gzip.open(path,'rt') as f: return json.load(f)

def score(meta,p):
    overall=[];early=[]
    for year,ix in meta.groupby('year').groups.items():
        indices=np.asarray(list(ix));overall.append(metrics(meta.y.iloc[indices],p[indices])['accuracy'])
        # Week labels vary across seasons; use actual completed games per team.
        # gate was computed causally from the feature matrices, not this label field.
        m=meta.early_sample.iloc[indices].to_numpy(bool)
        if m.any():early.append(metrics(meta.y.iloc[indices[m]],p[indices[m]])['accuracy'])
    return dict(utility=float(.5*np.mean(overall)+.5*np.mean(early)),
                macro_season_accuracy=float(np.mean(overall)),macro_early_accuracy=float(np.mean(early)),
                pooled=metrics(meta.y,p))
