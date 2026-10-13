"""Compare frozen v1 and v2 on already-inspected 2021-2025 development data.

No settings are selected here. Requires the pinned schedules in /tmp/rank-backtest.
Run: OPENBLAS_NUM_THREADS=1 python research/win_quality_development.py
"""
import json
from pathlib import Path
import numpy as np
from win_quality import load, fit, SIGMA, SCALE, REV

settings = json.loads(Path(__file__).with_name('win-quality-calibration.json').read_text())['selected']

def evaluate(S, corrected):
    n = S['n']
    prior = np.where(S['fbs'], 0., -settings['divisionGap'])
    prior -= prior.mean()
    ref = np.r_[S['fbs'] / S['fbs'].sum(), 0.]
    earned = np.zeros(n)
    losses = np.zeros(n)
    log_loss = brier = 0.
    observations = 0
    for cutoff in sorted(set(S['cutoff'])):
        train = np.flatnonzero(S['time'] + 21600 <= cutoff)
        test = np.flatnonzero(S['cutoff'] == cutoff)
        r, inverse = fit(S, train, settings['shrink'] if corrected else .05,
                         settings['homeFieldShrink'] if corrected else .0001,
                         prior if corrected else None,
                         settings['homeField'] if corrected else 0)
        if len(train):
            h, a, x = S['h'][test], S['a'][test], S['x'][test]
            edge = r[h] - r[a] + x * r[n]
            variance = (inverse[h,h]+inverse[a,a]-2*inverse[h,a]+x*x*inverse[n,n]
                        +2*x*(inverse[h,n]-inverse[a,n])) * SIGMA**2
            p = 1 / (1 + np.exp(np.clip(-edge / np.sqrt(SCALE*SCALE+3*variance/np.pi**2), -40, 40)))
            y = (S['m'][test] > 0).astype(float)
            log_loss += float((-y*np.log(p)-(1-y)*np.log(1-p)).sum())
            brier += float(((p-y)**2).sum())
            observations += len(test)
        benchmark = float(ref @ r) if corrected else 0
        cov = inverse @ ref
        ref_variance = float(ref @ cov)
        for g in test:
            w,l = (S['h'][g],S['a'][g]) if S['m'][g] > 0 else (S['a'][g],S['h'][g])
            site = S['x'][g] * (1 if w == S['h'][g] else -1)
            variance = inverse[l,l]+site*site*inverse[n,n]-2*site*inverse[l,n]
            variance += ref_variance-2*cov[l]+2*site*cov[n] if corrected else -1/(n*.05)
            edge = r[l] - benchmark - site*r[n]
            q = 1 / (1 + np.exp(np.clip(-edge / np.sqrt(SCALE*SCALE+3*max(0,variance)*SIGMA**2/np.pi**2),-40,40)))
            earned[w] += round(q,6) * (2 if corrected else 1)
            losses[l] += 1
    scores = np.round(earned-losses,6)
    h,a = S['h'],S['a']
    w,l = np.where(S['m']>0,h,a),np.where(S['m']>0,a,h)
    agree = np.where(scores[w]>scores[l],1.,np.where(scores[w]==scores[l],.5,0.))
    masks = {'all':np.ones(len(h),bool), 'fbs':S['fbs'][h]&S['fbs'][a],
             'cross':S['fbs'][h]!=S['fbs'][a], 'fcs':~S['fbs'][h]&~S['fbs'][a]}
    return dict(observations=observations,logLossSum=log_loss,brierSum=brier,
                agreement={k:dict(correct=float(agree[mask].sum()),games=int(mask.sum())) for k,mask in masks.items()})

def main():
    totals = {name:dict(observations=0,logLossSum=0.,brierSum=0.,agreement={k:dict(correct=0.,games=0) for k in ['all','fbs','cross','fcs']})
              for name in ['v1','v2']}
    per_year, inputs = [], []
    for year in range(2021,2026):
        S=load(year)
        inputs.append(dict(year=year,sha256=S['sha256']))
        row={'year':year}
        for name in totals:
            result=evaluate(S,name=='v2')
            row[name]=result
            for k in ['observations','logLossSum','brierSum']:totals[name][k]+=result[k]
            for k in result['agreement']:
                for metric in ['correct','games']:totals[name]['agreement'][k][metric]+=result['agreement'][k][metric]
        per_year.append(row)
        print(year,flush=True)
    for result in totals.values():
        result['logLoss']=result['logLossSum']/result['observations']
        result['brier']=result['brierSum']/result['observations']
        for r in result['agreement'].values():r['rate']=r['correct']/r['games']
    report=dict(status='development comparison, not an untouched holdout',sourceRevision=REV,
                scope='Known FBS/FCS games only. No future scores enter pre-week fits; frozen 2014-2019 division priors are available throughout these later seasons. Lower-division record fixes are tested separately.',
                settings=settings,inputs=inputs,metrics=totals,perYear=per_year)
    Path(__file__).with_name('win-quality-development.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(totals),flush=True)

if __name__=='__main__':main()
