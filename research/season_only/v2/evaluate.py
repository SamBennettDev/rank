"""Development comparisons, phase diagnostics, true quote-time matching, and ablations."""
import json
import numpy as np
import pandas as pd
from common import OUT,INPUT,CACHE,PARENT
from evaluate import metrics,paired
from model import FEATURE_SETS,game_counts
from market import consensus,validate,load_quotes
from build import CACHE as OLD_CACHE

def phase_metrics(frame,columns):
    rows=[]
    phases=[('all',np.ones(len(frame),bool)),('weeks_4_6',~frame.postseason&frame.week.between(4,6)),
        ('regular_week_7_onward',~frame.postseason&frame.week.ge(7)),('postseason',frame.postseason)]
    if 'min_games_before' in frame:phases.append(('either_team_at_most_five_games',frame.min_games_before.le(5+1e-8)))
    for phase,mask in phases:
        for col in columns:
            good=mask&frame[col].notna()
            if good.sum():rows.append(dict(phase=phase,method=col.removeprefix('p_'),**metrics(frame.y[good],frame.loc[good,col])))
    return rows

def main():
    base=pd.read_csv(PARENT/'results/predictions.csv.gz',low_memory=False)
    old=pd.read_csv(PARENT/'results/graph-predictions.csv.gz');assert np.array_equal(base.game_id,old.game_id)
    base['p_v1_recommended']=old.p_graph_ensemble
    base=base[base.year.ge(2007)].reset_index(drop=True)
    for feature in FEATURE_SETS:
        p=np.concatenate([np.load(CACHE/f'prediction_{feature}_{year}.npy') for year in range(2007,2027)])
        assert len(p)==len(base)
        base['p_v2_'+feature]=p
    chosen=json.loads((OUT/'selection.json').read_text())['chosen']['settings']['feature_set']
    from blend import mix
    policy=json.loads((OUT/'blend-selection.json').read_text())['chosen']
    gates_h=np.concatenate([np.load(OLD_CACHE/f'{year}.npz')['xh'] for year in range(2007,2027)])
    gates_a=np.concatenate([np.load(OLD_CACHE/f'{year}.npz')['xa'] for year in range(2007,2027)])
    base['min_games_before']=np.minimum(game_counts(gates_h),game_counts(gates_a))
    base['p_v2_recommended']=mix(base['p_v2_'+chosen].to_numpy(),base.p_v1_recommended.to_numpy(),gates_h,gates_a,policy)
    primary=(base['mode']=='weekly')&base.fbs
    development=base[primary&base.year.between(2020,2025)]
    columns=['p_v1_recommended','p_v2_recommended']+['p_v2_'+f for f in FEATURE_SETS]
    phases=phase_metrics(development,columns+['p_spread_market','p_moneyline_market','p_massey'])
    summary=pd.DataFrame(phases);summary.to_csv(OUT/'phase-metrics.csv',index=False,float_format='%.10f')
    comparisons={}
    for column in columns:
        for benchmark in ['p_v1_recommended','p_spread_market','p_moneyline_market','p_massey']:
            m=development[column].notna()&development[benchmark].notna()
            comparisons[column+':vs:'+benchmark]=dict(model=metrics(development.y[m],development.loc[m,column]),
                benchmark=metrics(development.y[m],development.loc[m,benchmark]),
                comparison=paired(development.y[m],development.loc[m,column],development.loc[m,benchmark],development.year[m]))
    annual=[];frozen=[]
    for year in range(2007,2027):
        for mode in ['weekly','frozen_week6']:
            f=base[(base['mode']==mode)&base.fbs&base.year.eq(year)]
            if not len(f):continue
            for col in columns:annual.append(dict(year=year,mode=mode,method=col.removeprefix('p_'),**metrics(f.y,f[col])))
        f=base[(base['mode']=='frozen_week6')&base.fbs&base.year.eq(year)]
        if year<=2025 and year>=2020 and len(f):frozen.append(f)
    frozen=pd.concat(frozen,ignore_index=True)
    freeze={col.removeprefix('p_'):metrics(frozen.y,frozen[col]) for col in columns}
    pd.DataFrame(annual).to_csv(OUT/'season-metrics.csv',index=False,float_format='%.10f')
    # Genuine public 2026 quote snapshots matched to the same Monday model cutoff.
    quotes=load_quotes()
    current=base[primary&base.year.eq(2026)].copy();strict=[];quote_rows=[]
    for age in [24,72]:
        money=[];spreads=[]
        for row in current.itertuples():
            ml=consensus(quotes,row.game_id,row.cutoff,age,'moneyline')
            sp=consensus(quotes,row.game_id,row.cutoff,age,'spread')
            money.append(ml['value'] if ml else np.nan);spreads.append(sp['value'] if sp else np.nan)
            for market,item in [('moneyline',ml),('spread',sp)]:
                if item:quote_rows.append(dict(game_id=row.game_id,cutoff=row.cutoff,market=market,**item))
        for market,p in [('moneyline',np.asarray(money)),('spread',np.asarray(spreads))]:
            mask=np.isfinite(p);f=current[mask]
            if market=='spread':p=np.where(p>0,1.,np.where(p<0,0.,.5))
            if not len(f):continue
            benchmark=metrics(f.y,p[mask])
            # Spread sign has no probability model; do not report its fake log loss.
            if market=='spread':benchmark={k:benchmark[k] for k in ['games','accuracy']}
            strict.append(dict(market=market,max_age_hours=age,games=len(f),benchmark=benchmark,
                models={col.removeprefix('p_'):metrics(f.y,f[col]) for col in columns}))
    pd.DataFrame(quote_rows).to_csv(OUT/'matched-quote-audit.csv',index=False)
    result=dict(chosen_feature_set=chosen,weekly_development=phase_metrics(development,columns),
        paired=comparisons,frozen_week6=freeze,timestamped_2026=strict,
        evaluation_status='Retrospective development and 2026 replay; no past season is newly untouched. Timestamped matches use <= the model cutoff and fixed freshness caps.')
    (OUT/'evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    base[['year','game_id','mode','cutoff','week','postseason','home','away','venue','fbs','y','margin','min_games_before']+columns].to_csv(OUT/'predictions.csv.gz',
        index=False,float_format='%.10f',compression=dict(method='gzip',mtime=0))
    print('V2 development',json.dumps(result['weekly_development'],indent=2),flush=True)
    print('Strict timestamped comparison',json.dumps(strict,indent=2),flush=True)

if __name__=='__main__':main()
