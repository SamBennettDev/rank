"""Fixed current-team and historical extreme-win exclusion audit; no selection."""
import json
import sys
from dataclasses import replace
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.special import expit

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from prepare import INPUT,ROOT
from data import load,week6
from graph_build import graph_features
from rich_evaluate import model_probability
from graph_evaluate import probability as graph_probability
from robust.features import inputs,records
from robust.bounded_network import BoundedRanker
from robust.capped_features import build as capped_build

OUT=HERE/'polished-results'
T=json.loads((OUT/'calibration.json').read_text())['temperature']

def summarize(values):
    x=np.asarray(values)
    return dict(cases=len(x),mean=float(x.mean()),median=float(np.median(x)),p95=float(np.quantile(x,.95)),maximum=float(x.max()))

def audit_year(year):
    s=load(year);_,idx,_=week6(s)
    rich=pd.read_csv(ROOT/'data/seasons/2026/rich.csv'if year==2026 else INPUT/f'rich_{year}.csv')
    olddir=HERE.parent/'results'
    r=json.loads((olddir/f'rich-rolling-models/{year}.json').read_text())
    g=json.loads((olddir/f'graph-rolling-models/{year}.json').read_text())
    model=json.loads((OUT/f'annual-models/{year}.json').read_text())
    models=[BoundedRanker.fromdict(m)for m in model['models']]
    n=s.n;h=np.repeat(np.arange(n),n);a=np.tile(np.arange(n),n);v=np.zeros(n*n)
    external=np.zeros(n);total=None
    if year==2026:
        bundle=json.loads((ROOT/'data/seasons/2026/neural.json').read_text());snap=bundle['snapshots'][-1]
        assert bundle['teamIds']==s.ids.tolist()
        external=np.array(snap['externalLosses']);total=np.array(snap['recordGamesPlayed'])
    def matrices(indices,source=s):
        graph=graph_features(source,indices,rich)
        x,(ng,nl)=capped_build(source,indices,rich)
        p=.75*model_probability(r,graph[h,:64],graph[a,:64],v)+.25*graph_probability(g,graph[h],graph[a],v)
        strength=np.mean([m.strength(x,ng,nl+external)for m in models],axis=0)
        q=expit(T*(strength[:,None]-strength[None,:]))
        return p.reshape(n,n),q,ng,strength
    base_old,base_new,ng,strength=matrices(idx)
    oldmean,newmean=base_old.mean(1),base_new.mean(1)
    eligible=np.flatnonzero(ng>0 if total is None else total>0)
    games=s.games.iloc[idx].copy();games['absolute_margin']=games.margin.abs()
    if year==2026:
        selected=games[(games.home.isin([154,204,2483,99]))|(games.away.isin([154,204,2483,99]))]
    else:
        candidates=games[(games.absolute_margin>=35)&np.where(games.margin>0,s.fbs[games.h],s.fbs[games.a])]
        selected=candidates.sort_values(['absolute_margin','game_id'],ascending=[False,True]).head(8)
    cases=[];score_only=[]
    for game in selected.itertuples():
        subset=idx[s.games.iloc[idx].game_id.to_numpy()!=game.game_id]
        old,new,_,_=matrices(subset);oldm,newm=old.mean(1),new.mean(1)
        targets=[int(game.h if game.margin>0 else game.a)] if year!=2026 else [int(t)for t in [game.h,game.a]if s.ids[t]in[154,204,2483,99]]
        for t in targets:
            cases.append(dict(year=year,teamId=int(s.ids[t]),team=s.names[t],gameId=int(game.game_id),
                home=game.home_team,away=game.away_team,homePoints=int(game.home_points),awayPoints=int(game.away_points),
                previousRank=int(1+np.sum(oldmean[eligible]>oldmean[t])),previousExcludedRank=int(1+np.sum(oldm[eligible]>oldm[t])),
                newRank=int(1+np.sum(newmean[eligible]>newmean[t])),newExcludedRank=int(1+np.sum(newm[eligible]>newm[t])),
                previousProbabilityChange=float(oldm[t]-oldmean[t]),newProbabilityChange=float(newm[t]-newmean[t])))
        if abs(game.margin)>35:
            changed_games=s.games.copy();row=changed_games.index[changed_games.game_id.eq(game.game_id)][0]
            if game.margin>0:changed_games.loc[row,'home_points']=game.away_points+35
            else:changed_games.loc[row,'away_points']=game.home_points+35
            changed_games.loc[row,'margin']=np.sign(game.margin)*35
            score_old,score_new,_,_=matrices(idx,replace(s,games=changed_games))
            np.testing.assert_allclose(score_new,base_new,atol=1e-12,rtol=0)
            for t in targets:
                score_only.append(dict(year=year,gameId=int(game.game_id),team=s.names[t],
                    previousRankChange=int(np.sum(score_old.mean(1)[eligible]>score_old.mean(1)[t])-np.sum(oldmean[eligible]>oldmean[t])),
                    newRankChange=int(np.sum(score_new.mean(1)[eligible]>score_new.mean(1)[t])-np.sum(newmean[eligible]>newmean[t])),
                    previousProbabilityChange=float(score_old[t].mean()-oldmean[t]),newProbabilityChange=float(score_new[t].mean()-newmean[t])))
        print('Sensitivity',year,game.game_id,flush=True)
    current=[]
    if year==2026:
        for tid in [154,204,2483,99]:
            t=int(np.flatnonzero(s.ids==tid)[0]);losses=records(graph_features(s,idx,rich))[1][t]+external[t]
            deduction=models[0].loss_penalty*losses/(ng[t]+models[0].loss_prior)
            current.append(dict(teamId=tid,team=s.names[t],newRank=int(1+np.sum(strength[eligible]>strength[t])),
                rankWithoutOwnLossDeduction=int(1+np.sum(strength[eligible]>strength[t]+deduction)),
                calibratedLossDeduction=float(T*deduction)))
    return cases,current,score_only

def main():
    cases=[];current=[];score_only=[]
    for year in list(range(2020,2026))+[2026]:
        rows,c,sc=audit_year(year);cases+=rows;current+=c;score_only+=sc
    historical=[c for c in cases if c['year']<2026]
    summary={}
    for name,prefix in [('previous','previous'),('new','new')]:
        summary[name]=dict(absoluteRankChange=summarize([abs(c[prefix+'ExcludedRank']-c[prefix+'Rank'])for c in historical]),
            absoluteProbabilityChange=summarize([abs(c[prefix+'ProbabilityChange'])for c in historical]))
    result=dict(selection='Eight largest winning margins by FBS teams through Week 6 in each of 2020–2025, ties by game ID; every game of Wake Forest, Oregon State, Oregon and LSU in 2026.',
        interpretation='Historical ranks use average full-field neutral win probability for BOTH models. The previous consensus rank may differ slightly. New scalar strength and its consensus rank agree. Game removal changes sample size, efficiency and opponent fits, so this is not a pure scoring-margin effect or a statistical confidence interval. These audits do not select the model.',
        historical=summary,currentLossCounterfactuals=current,cases=cases,scoreOnly=score_only,
        scoreOnlyInterpretation='Change an extreme game score to a 35-point margin, holding the winner, sample size, opponent, venue and actual play summaries fixed. This isolates the score-feature path, not a realistic alternative game. New pair probabilities must be unchanged to 1e-12 across the entire field.')
    (OUT/'sensitivity.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
