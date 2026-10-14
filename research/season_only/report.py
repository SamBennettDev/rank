"""Generate portable research reports and publication-ready charts from saved evidence."""
import html
import json
from collections import Counter
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from build import OUT
from prepare import HERE, INPUT
from evaluate import metrics
from train import primary

DESCRIPTIONS = {
 'win_percentage':'Win fraction, shrunk equally toward .500. No schedule adjustment.',
 'net_wins':'Wins minus losses. No schedule adjustment.',
 'pythagorean':'Points scored and allowed predict expected win fraction; tune the exponent.',
 'colley':'Solve the schedule Laplacian using wins and losses, with an equal .500 start.',
 'bradley_terry':'Fit pairwise win probabilities with equal ridge shrinkage and venue adjustment.',
 'massey':'Least-squares team strengths explain score margins, opponent quality, and venue.',
 'capped_margin':'Massey fit with capped margins to reduce the influence of blowouts.',
 'robust_margin':'Huber-loss margin fit reduces influence from unusual games.',
 'recency_margin':'Capped margin fit downweights older games within this season.',
 'win_springs':'Schedule-adjusted least squares using only the sign of each result.',
 'margin_springs':'Win springs weighted by margin; large wins pull strengths farther apart.',
 'elo':'Sequential game updates from equal zero ratings; tune update speed and margin scaling.',
 'offense_defense_score':'Separate schedule-adjusted scoring offense and defense; rank their sum.',
 'pagerank':'A loss-to-winner graph passes credit to teams that beat strong opponents.',
 'keener':'Positive eigenvector of nonlinear score shares, normalized by games played.',
 'lrmc':'A Markov chain with margin-based game transitions and uniform teleportation.',
 'epa_units':'Fit schedule-adjusted offensive and defensive EPA per play, with score fallback.',
 'success_units':'Fit schedule-adjusted offensive and defensive success rates, with score fallback.',
 'epa_margin':'Blend adjusted EPA strength and schedule-adjusted score margins.',
 'success_margin':'Blend adjusted success-rate strength and schedule-adjusted score margins.',
 'epa_success':'Blend adjusted EPA and success-rate strength.',
 'evidence_blend':'Blend EPA, success, optional special teams, and margin according to sample size and signal agreement.',
 'neural_annual':'Shared team-strength network on 28 statistics; weights refit on earlier seasons.',
 'neural_frozen':'Original selected network trained once on 2002–2013, with settings selected on 2014–2019.',
 'neural_ensemble':'Original shared network blended equally with a feature logistic regression.',
 'logistic_features':'Supervised logistic regression on numeric team features and venue.',
 'gradient_boosting':'Symmetrized histogram gradient-boosted trees on numeric matchup features.',
 'extra_trees':'Symmetrized extremely randomized trees on numeric matchup features.',
 'rich_neural':'Three-seed 8-neuron antisymmetric matchup network with 64 play and score features.',
 'rich_ensemble':'Validation chose 100% of the rich network; this is an alias, not another learner.',
 'graph_neural':'Three-seed 16-neuron antisymmetric network with 152 current-season graph features.',
 'graph_ensemble':'Recommended: 75% rich-network and 25% opponent-graph-network probabilities.',
 'market_distilled_neural':'16-neuron shared team-strength network trained with past outcomes and past market probabilities as labels; prices are absent at inference.',
 'market_distilled_ensemble':'Validation chose zero market-distilled weight; this is the recommended graph blend again.',
 'moneyline_market':'Median same-book, paired American moneylines after removing each book’s overround.',
 'spread_market':'Favorite implied by archived paired spreads; probability calibration uses design-year games.',
 'spread_implied_market':'An inferred ranking fitted to archived 2026 spreads through Week 6; not a published sportsbook poll.',
 'cfbd_pregame_elo':'Archived CFBD pregame Elo with the standard Elo logistic curve and a 55-point venue adjustment; external benchmark with historical carryover.',
}

def read(name): return json.loads((OUT / name).read_text())
def pct(x): return f'{100*x:.2f}%'
def label(s): return s.replace('_',' ').title().replace('Epa','EPA').replace('Cfbd','CFBD')
def esc(x): return html.escape(str(x))
def table(frame): return frame.to_html(index=False, escape=True, border=0, classes='data')

STYLE = '''body{font:16px/1.6 system-ui,sans-serif;color:#182d40;background:#f5f8fc;margin:0}
main{max-width:1180px;margin:auto;padding:44px 28px}h1{font-size:38px;line-height:1.15}h2{margin-top:42px;font-size:25px}
h3{font-size:19px}p{max-width:1000px}a{color:#176192}table{border-collapse:collapse;width:100%;font-size:14px;background:white}
td,th{padding:10px 12px;text-align:left;border-bottom:1px solid #dce4ed}th{background:#e7eef6;position:sticky;top:0}
.scroll{overflow:auto;max-height:620px;border:1px solid #dce4ed;border-radius:8px}.callout{background:#fff;padding:20px;border-left:5px solid #126d92}
.muted{color:#526879}.plot{width:100%;background:white;border-radius:8px}select,input{padding:10px;border:1px solid #b8c8d7;border-radius:6px;font:inherit;margin:5px}
nav a{display:inline-block;margin:0 18px 10px 0}code{background:#e7eef6;padding:2px 5px}.cards{display:flex;gap:15px;flex-wrap:wrap}.card{background:white;padding:18px;flex:1;min-width:180px}.big{font-size:29px;font-weight:700}
@media print{main{padding:10px}.scroll{max-height:none;overflow:visible}nav,select,input{display:none}h2{break-after:avoid}}'''

def document(title, body, script=''):
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+STYLE+'</style></head><body><main>'+body+'</main>'+script+'</body></html>'

def full_predictions():
    p=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False)
    for prefix in ['rich','graph','teacher']:
        extra=pd.read_csv(OUT/f'{prefix}-predictions.csv.gz')
        assert np.array_equal(p.game_id,extra.game_id)
        for col in extra.columns:
            if col.startswith('p_'): p[col]=extra[col]
    return p

def charts(p, annual):
    plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'white'})
    fig,axs=plt.subplots(1,2,figsize=(12,4.7),constrained_layout=True)
    base=primary(p)&p.year.between(2020,2025)
    for ax,market,title in zip(axs,['spread_market','moneyline_market'],['Archived spread favorites','Archived moneyline favorites']):
        m=base&p['p_'+market].notna();names=['massey','success_margin','gradient_boosting','graph_ensemble',market]
        values=[metrics(p.y[m],p.loc[m,'p_'+n])['accuracy']*100 for n in names]
        ax.barh([label(n) for n in names],values,color=['#b7c9d9']*3+['#176d91','#ba713d'])
        ax.set_xlim(64,76);ax.set_xlabel('Winner accuracy (%)');ax.set_title(title+f'\nSame {m.sum():,} games, 2020–2025')
        for j,v in enumerate(values): ax.text(v+.1,j,f'{v:.2f}%',va='center')
    fig.savefig(HERE/'accuracy.png',dpi=180);plt.close(fig)
    fig,ax=plt.subplots(figsize=(12,4.5),constrained_layout=True)
    a=annual[(annual.market=='spread_market')&annual.year.lt(2026)]
    ax.plot(a.year,a.neural_accuracy*100,'o-',color='#176d91',label='Recommended neural blend')
    ax.plot(a.year,a.market_accuracy*100,'o-',color='#ba713d',label='Archived spread favorites')
    ax.axvspan(2006.5,2019.5,color='#e6edf4',alpha=.6);ax.text(2012,81,'Retrospective design / hindcast years',ha='center',fontsize=10)
    ax.set_ylim(61,83);ax.set_xticks(a.year);ax.tick_params(axis='x',rotation=45)
    ax.set_ylabel('Winner accuracy (%)');ax.set_title('Same-game season comparisons; each neural weight fit uses earlier seasons')
    ax.legend(loc='lower right');fig.savefig(HERE/'seasons.png',dpi=180);plt.close(fig)
    fig,ax=plt.subplots(figsize=(6.5,5),constrained_layout=True)
    for name,col,color in [('Neural blend','graph_ensemble','#176d91'),('Moneyline market','moneyline_market','#ba713d')]:
        m=base&p.p_moneyline_market.notna();q=p.loc[m,'p_'+col];y=p.y[m]
        bins=pd.cut(q,np.linspace(0,1,11),include_lowest=True)
        d=pd.DataFrame({'p':q,'y':y,'bin':bins}).groupby('bin',observed=True).agg(p=('p','mean'),y=('y','mean'),n=('p','size'))
        ax.plot(d.p,d.y,'o-',label=name,color=color)
    ax.plot([0,1],[0,1],':',color='#8093a2');ax.set(xlabel='Predicted home win probability',ylabel='Observed home win fraction',title='Calibration on the same 3,025 moneyline games',xlim=(0,1),ylim=(0,1))
    ax.legend();fig.savefig(HERE/'calibration.png',dpi=180);plt.close(fig)

def main():
    base=read('evaluation.json');graph=read('graph-evaluation.json');teacher=read('teacher-evaluation.json')
    p=full_predictions();r=pd.read_csv(OUT/'week6-2026-rankings.csv')
    weekly=primary(p)&p.year.between(2020,2025);frozen=(p['mode']=='frozen_week6')&p.fbs&p.year.between(2020,2025)
    methods=[c[2:] for c in p.columns if c.startswith('p_')]
    rows=[]
    for mode,mask in [('weekly',weekly),('frozen_week6',frozen)]:
        for method in methods:
            m=mask&p['p_'+method].notna()
            if m.sum(): rows.append(dict(mode=mode,method=method,**metrics(p.y[m],p.loc[m,'p_'+method])))
    summary=pd.DataFrame(rows);summary.to_csv(OUT/'summary-metrics.csv',index=False,float_format='%.10f')
    annual=pd.DataFrame([dict(year=d['year'],market=d['market'],games=d['neural']['games'],neural_accuracy=d['neural']['accuracy'],
        market_accuracy=d['benchmark']['accuracy'],difference=d['accuracy_difference']) for d in graph['season_market_comparison']])
    annual.to_csv(OUT/'matched-season-comparison.csv',index=False,float_format='%.10f')
    charts(p,annual)
    current=r[(r.method=='graph_ensemble')&(r.field=='fbs')].sort_values('rank')
    main_accuracy=metrics(p.y[weekly],p.loc[weekly,'p_graph_ensemble'])['accuracy']
    spread=graph['paired']['weekly:graph_ensemble:vs:spread_market'];ml=graph['paired']['weekly:graph_ensemble:vs:moneyline_market']
    designs=[read(f) for f in ['neural-design.json','rich-design.json','graph-design.json','teacher-design.json']]
    config_count=sum(len(d) for d in designs);experiment_networks=3*config_count+3
    def network_count(d):
        return len(d['models']) if 'models' in d else sum(len(c['models']) for c in d['components'])
    annual_networks=sum(network_count(read(f'{directory}/{y}.json')) for directory in ['rolling-models','rich-rolling-models','graph-rolling-models','teacher-rolling-models'] for y in range(2007,2027))
    body=f'''<nav><a href="REPORT.pdf">PDF report</a><a href="METHODS.html">Methods and features</a><a href="README.md">Reproduction guide</a><a href="results/week6-2026-rankings.csv">All selected rankings CSV</a></nav>
<h1>College football: learn from the past, rank from this season</h1>
<p class="muted">2026 Week 6 snapshot • 2026-10-11 08:30 UTC • Research completed 2026-10-14</p>
<div class="callout"><strong>The selected neural model improves the conventional baselines, but does not beat archived betting favorites overall.</strong>
It predicts with current-season statistics and shared weights learned from earlier seasons. The market comparison uses exactly the same games for both predictors.</div>
<div class="cards"><div class="card"><div class="big">{pct(main_accuracy)}</div>Neural winner accuracy<br>3,603 games, 2020–2025</div>
<div class="card"><div class="big">{experiment_networks:,}</div>Experimental network fits<br>{config_count} configurations + convergence check</div>
<div class="card"><div class="big">24 seasons</div>Historical input archive<br>2002–2025; 19 annual hindcast seasons</div></div>
<h2>What “preseason agnostic” means</h2><p>For a game in 2026, the network sees only numeric statistics from games already completed in 2026. Team names, identifiers, conference, division, talent ratings, polls, and preseason estimates are absent from the feature vector. Every team starts equally. Historical examples use the same kind of pregame features, paired with the eventual winner and score margin. The resulting shared weights learn general relationships, such as how much an opponent-adjusted passing advantage predicts a win. Historical team ratings never carry over.</p>
<p>The recommended probability is <code>0.75 × rich neural probability + 0.25 × graph neural probability</code>, selected on 2018–2019. Each component averages three random seeds. The rich model has 64 numeric features and an 8-neuron hidden layer; the graph model has 152 numeric features and a 16-neuron layer. They learn matchup context while enforcing that swapping teams reverses the prediction. Neutral-site rankings sort each team’s mean predicted win probability against the same complete modeled field.</p>
<h2>Betting comparison on identical games</h2>'''
    market_rows=[]
    for title,d in [('Spread favorites',spread),('Moneyline favorites',ml)]:
        market_rows.append({'Benchmark':title,'Games':d['neural']['games'],'Neural accuracy':pct(d['neural']['accuracy']),
            'Market accuracy':pct(d['benchmark']['accuracy']),'Neural minus market':f"{100*d['comparison']['accuracy_difference']:+.2f} points",
            '95% season-bootstrap interval':' to '.join(f'{100*x:+.2f}' for x in d['comparison']['accuracy_95_interval'])+' points',
            'Neural log loss':f"{d['neural']['log_loss']:.4f}",'Market log loss':f"{d['benchmark']['log_loss']:.4f}"})
    body+=table(pd.DataFrame(market_rows))+'''<p>Spread and moneyline coverage differ; their accuracies cannot be compared as if they came from one cohort. Moneylines are paired within each sportsbook, converted to probabilities, de-vigged, then aggregated across books. Spread favorites use the spread sign; spread probabilities use a design-period logistic conversion. Neutral-site and moved-game home/away reversals are reconciled against the schedule.</p>
<p><strong>These are archived quotes, with no reliable quote-capture timestamp.</strong> They cannot be certified as opening or closing prices or as available at the model’s Monday forecast cutoff. This is a predictive benchmark, not a profitability test. Five or six season blocks also limit the precision of the bootstrap intervals. The later seasons were already inspected in this repository’s earlier work and across these rounds, so they are development evidence, not an untouched holdout.</p><img class="plot" src="accuracy.png" alt="Winner accuracy comparisons using identical games">
<h2>How much experimentation was actually done</h2>'''
    rounds=pd.DataFrame([
        ['Classical methods',151,'22 families','Equal starts; margins, wins, graphs, EPA, success, recency, robust fits'],
        ['Neural round 1',64,'192 network fits','28 features; rank and matchup nets; width, ridge, margin auxiliary loss'],
        ['Neural round 2',96,'288 network fits','64 features; focal loss, four-year training decay, regularization'],
        ['Neural round 3',32,'96 network fits','152 current-season neighbor and two-hop graph features'],
        ['Neural round 4',72,'216 network fits','Past market probabilities as supplemental labels; no live-price input'],
        ['Convergence check',1,'3 additional fits','1500-iteration budget; all three converged, validation got worse'],
    ],columns=['Experiment','Configurations','Fits / families','What changed'])
    body+=table(rounds)+f'<p>There were {annual_networks} additional annual network fits, for {experiment_networks+annual_networks:,} saved experimental and annual fits in total. Logistic regression, gradient boosting, and extremely randomized trees provide supervised non-neural comparisons. Architecture and blend choices use the designated older validation years. Annual weights and scales use only seasons earlier than the forecast season.</p>'
    body+='''<p>Round 1 trained on 2002–2013 and selected on 2014–2019. Later rounds trained on 2006–2017 and selected on 2018–2019. We reused these validation years while exploring ideas, so validation improvements themselves may reflect search overfitting. Results before 2020 are retrospective hindcasts because the architecture was chosen with later design data. All 2020–2025 comparisons remain development results. A future prospective season is required to establish a durable market edge.</p>
<p>The market-supervised rank network achieved 74.18% design validation accuracy. Giving it a larger optimization budget made all three seeds converge but reduced validation accuracy to 73.67%. Annual refits of that approach achieved 70.39% on 2020–2025. Blending it into the recommended network did not improve validation, so the selected market-supervised weight is zero. More training did not recover information absent from the inputs.</p>
<h2>2026 rankings through completed Week 6 games</h2><p>The default is the recommended neural blend. Switch methods to compare every selected approach, or inspect every experimental configuration. Rankings cover 138 FBS teams; the common reference field also includes FCS teams. Strength models use 748 completed modeled games. Lower-division games outside this modeled field are excluded. The spread-implied list fits 448 archived priced games and includes market expectations, so it is a benchmark rather than a season-only model.</p>
<label>Method <select id="method"></select></label><label>Field <select id="field"><option value="fbs">FBS</option><option value="fbs_fcs">FBS + FCS</option></select></label><label>Show <select id="limit"><option>25</option><option>10</option><option>138</option><option>266</option></select></label>
<p id="description" class="muted"></p><div class="scroll"><table><thead><tr><th>Rank</th><th>Team</th><th>Score (method-specific scale)</th></tr></thead><tbody id="rankings"></tbody></table></div>
<p><a href="results/week6-2026-future-games.csv">Download 791 future-game forecasts from this snapshot</a>. Scores across different ranking methods use different scales. Neural scores are mean neutral-site win probabilities across all 266 modeled teams, including the self matchup. These are predictive rankings, not a measure of earned accomplishments.</p>
<h2>Every selected method: results and Week 6 leaders</h2>'''
    selected=[]
    overall=summary[summary['mode']=='weekly'].set_index('method')
    for method in r.method.unique():
        names=r[(r.method==method)&(r.field=='fbs')].sort_values('rank').head(5).team.tolist()
        d=overall.loc[method] if method in overall.index else None
        selected.append({'Method':label(method),'Games':int(d.games) if d is not None else '—',
            '2020–25 accuracy':pct(d.accuracy) if d is not None else '—','Log loss':f'{d.log_loss:.4f}' if d is not None else '—',
            'Week 6 top five':', '.join(names),'How it works':DESCRIPTIONS[method]})
    body+='<div class="scroll">'+table(pd.DataFrame(selected))+'</div><p>All non-market methods in this table have the same 3,603-game weekly evaluation cohort. The static frozen network is reported separately in the downloadable metrics. Rich ensemble and market-distilled ensemble are aliases selected by zero/one blend weights, not additional independent successes. <a href="results/summary-metrics.csv">Complete accuracy, Brier score, and log-loss CSV</a>; classical margin errors are also in <a href="results/evaluation.json">the detailed JSON</a>.</p>'
    body+='<h2>Freezing ratings after Week 6</h2><p>The historical Week 6 experiment fixes features for the remainder of each season. It therefore tests the usefulness of the specific snapshot you asked for, without updating strengths after later results. The forecasts below share the same 2,703 future FBS games in 2020–2025; venue remains known.</p>'
    freeze_rows=[]
    for name in ['graph_ensemble','rich_neural','neural_annual','massey','success_margin','gradient_boosting']:
        d=summary[(summary['mode']=='frozen_week6')&summary.method.eq(name)].iloc[0]
        freeze_rows.append({'Method':label(name),'Games':int(d.games),'Winner accuracy':pct(d.accuracy),'Brier':f'{d.brier:.4f}','Log loss':f'{d.log_loss:.4f}'})
    body+=table(pd.DataFrame(freeze_rows))+'<p>Archived prices for later games may incorporate results, injuries, and information obtained after Week 6. Their comparison against a frozen Week 6 model is explicitly an unequal-information benchmark; the weekly comparisons above are the main market test.</p>'
    body+='<h2>Past seasons</h2><p>Each row below compares the recommended neural blend and the market on identical games in that season. The network’s weight fit uses earlier seasons only, although architecture selection used 2018–2019. No 2020 moneylines were available in the archive.</p><img class="plot" src="seasons.png" alt="Historical matched winner accuracy by season">'
    display=annual[annual.year.lt(2026)].copy();display['neural_accuracy']=display.neural_accuracy.map(pct);display['market_accuracy']=display.market_accuracy.map(pct);display['difference']=display.difference.map(lambda x:f'{100*x:+.2f} points')
    body+='<div class="scroll">'+table(display)+'</div><p>The selected blend beats both archived favorite benchmarks by a small point estimate in 2019, a validation season. It does not beat either market benchmark in any matched 2020–2025 season. <a href="results/matched-season-comparison.csv">Matched annual CSV</a>; <a href="results/graph-season-metrics.csv">neural per-season probability metrics</a>; <a href="results/season-metrics.csv">all classical per-season metrics</a>.</p>'
    body+='<h2>CFP committee comparison</h2><p>The College Football Playoff publishes committee rankings, not a public numerical winner-prediction algorithm. The benchmark picks the higher-ranked team using only a list published before kickoff. An unranked team counts as rank 26, and games between two unranked teams are omitted. The neural predictions continue to use their earlier Monday snapshot.</p>'
    cf=[]
    for name,d in graph['cfp'].items():
        cf.append({'Games':'Both teams ranked' if name=='both_ranked' else 'At least one team ranked','N':d['games'],'Neural accuracy':pct(d['neural']['accuracy']),
            'CFP higher-rank pick':pct(d['cfp_accuracy']),'Difference':f"{100*d['comparison']['accuracy_difference']:+.2f} points",'95% interval':' to '.join(f'{100*x:+.2f}' for x in d['comparison']['accuracy_95_interval'])+' points'})
    body+=table(pd.DataFrame(cf))+'''<p>The selected neural blend outperforms the CFP rank-order pick in these 2020–2025 development comparisons. The committee ranks accomplishments for selection; that is a different objective from predicting winners. The first 2026 CFP list is scheduled for November 3, so an official Week 6 CFP ranking does not exist. Sources: <a href="https://collegefootballplayoff.com/news/2026/8/6/sc-aug-2627">2026 schedule</a> and the official yearly tables linked in the saved <a href="inputs/cfp.json">recent</a> and <a href="inputs/cfp-earlier.json">earlier</a> archives. Verified transcription corrections are recorded alongside those tables.</p>
<h2>What the negative market result tells us</h2><p>Historical supervised learning is already in use. It improves the score-only baseline, but current-season team aggregates omit some information sportsbooks can use: injuries, expected availability, lineup changes, roster turnover, and matchup details not captured by the available plays. Sparse early-season schedules and limited FCS play coverage also constrain inference. More parameters or more optimization cannot guarantee access to those missing signals.</p>
<p>The next informative experiment is richer, timestamped current-season availability and play context, followed by a prospectively frozen evaluation protocol against timestamped prices. The existing source archive’s EPA and success labels may have been retrospectively regenerated with shared historical models; their underlying fitting vintage is not guaranteed. This study restricts game and feature dates but does not claim a full reconstruction of what a bettor could download at the time.</p>
<p>This search covers many established method families and supervised baselines. It does not cover every published algorithm or the private formulas of sportsbooks, FPI, or SP+. The evidence supports this particular implementation’s comparisons, not a claim of outperforming all known algorithms or of a world-first invention.</p>
<h2>Audit trail and exports</h2><p>All inputs, source hashes, model weights, design selections, and game-level predictions are saved. The raw play archive remains a download cache; compact game aggregates are included for reproduction. Charts use fixed saved probabilities.</p>
<ul><li><a href="results/predictions.csv.gz">Classical and basic neural game probabilities</a>, <a href="results/rich-predictions.csv.gz">rich</a>, <a href="results/graph-predictions.csv.gz">graph</a>, <a href="results/teacher-predictions.csv.gz">market-supervised</a></li>
<li><a href="results/week6-all-statistical-configurations.csv">All 151 statistical rankings</a>, <a href="results/week6-all-neural-configurations.csv">all 64 basic neural rankings</a>, <a href="results/week6-all-extended-neural-configurations.csv">all 200 additional neural rankings</a></li>
<li><a href="results/all-statistical-development.json">Statistical exploratory audit</a>, <a href="results/all-neural-development.json">basic neural exploratory audit</a>, <a href="results/all-extended-neural-development.json">additional neural exploratory audit</a>. These post-selection grids are exploratory; their best later-season configuration is not an unbiased winning-model selection.</li>
<li><a href="sources.json">Schedule and play provenance</a>, <a href="rich-sources.json">rich play provenance</a>, <a href="odds-sources.json">market provenance</a>, <a href="results/current-market-source.json">2026 spread source</a></li></ul>
<img class="plot" style="max-width:650px" src="calibration.png" alt="Neural and moneyline market calibration">'''
    ranks=r.to_dict('records')
    for filename,prefix in [('week6-all-statistical-configurations.csv','Trial statistical: '),('week6-all-neural-configurations.csv','Trial basic: '),('week6-all-extended-neural-configurations.csv','Trial extended: ')]:
        trial=pd.read_csv(OUT/filename)
        for row in trial.to_dict('records'):
            row['method']=prefix+row['method'];row['field']='fbs';ranks.append(row)
    payload=json.dumps({'rankings':ranks,'descriptions':DESCRIPTIONS},separators=(',',':')).replace('</','<\\/')
    script='''<script id="data" type="application/json">'''+payload+'''</script><script>
const data=JSON.parse(document.getElementById('data').textContent), select=document.getElementById('method');
const names=[...new Set(data.rankings.map(r=>r.method))];for(const n of names){const o=document.createElement('option');o.value=n;o.textContent=n;select.append(o)}select.value='graph_ensemble';
function render(){const name=select.value,field=document.getElementById('field').value,limit=+document.getElementById('limit').value;
document.getElementById('description').textContent=data.descriptions[name]||'Experimental configuration: design-period weights; retrospective later-season audit. Not the annually refit recommended model.';
const body=document.getElementById('rankings');body.replaceChildren();const rows=data.rankings.filter(r=>r.method===name&&r.field===field).sort((a,b)=>a.rank-b.rank).slice(0,limit);
for(const r of rows){const tr=document.createElement('tr');for(const value of [r.rank,r.team,Number(r.score).toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}body.append(tr)}}
for(const id of ['method','field','limit'])document.getElementById(id).addEventListener('change',render);render();</script>'''
    (HERE/'REPORT.html').write_text(document('Season-only college football research',body,script))
    # A separate reference document carries formulas and full feature lists.
    counts=Counter(d['family'] for d in read('methods.json'))
    methods_body='<nav><a href="REPORT.html">Results and interactive rankings</a><a href="README.md">Reproduction</a></nav><h1>Methods and feature reference</h1>'
    methods_body+='''<p>The common probability form for strength models is sigmoid(a × (r_home − r_away) + b × venue_effect). Coefficients are fit on pregame examples from earlier seasons. Equal shrinkage applies to all teams. The venue effect used by the classical methods is fit from this season; neural models learn a shared historical venue coefficient. This is a generic game effect, not a team-specific preseason rating.</p>
<p>Massey variants minimize the weighted squared error of margin − (r_home − r_away + H × venue), plus ridge penalties. Colley solves (L + 2I)r = 1 + (wins − losses)/2, then centers at .500. Bradley–Terry minimizes pairwise binary cross entropy plus ridge. Offense/defense fits use metric = intercept + offense_team − defense_opponent + H × venue, weighted by snaps for play statistics. The score fallback preserves coverage when play data is missing.</p>
<p>The evidence blend forms U = 0.5 × 60 × (EPA offense + defense) + 0.5 × 100 × (success offense + defense) + special-team weight × adjusted special EPA. Reliability is c/(c+n) divided by (1+|U−M|/d), with current-season evidence c, design constants n and d, and margin strength M. Final strength is (1−a×reliability)M + a×reliability×U. The factor constants translate per-play scales for the grid; they are not claims of exact football point equivalence.</p>
<p>The rank net is a linear residual plus an evidence-gated tanh hidden layer shared by every team. The gate uses standardized-input clipping consistently with inference. The matchup net forms differences and mean context; its logit is one half of g(difference, context) minus g(negative difference, context), plus venue. Swapping teams and reversing venue therefore gives the negative logit. An equal neutral snapshot gives .500.</p>
<p>Graph inputs concatenate 64 current-season numeric features, means of those features across played opponents, two-hop means of the first 16 features, and opponent standard deviations for eight strength/evidence features. The graph is built only from games before the cutoff. This is a fixed GraphSAGE-style neighborhood aggregation followed by a learned shared neural network, not a claim that the entire graph propagation is end-to-end learned.</p>
<p>Training uses analytic-gradient L-BFGS, binary cross entropy, optional focal weighting, optional Huber loss against clipped margin/12, and ridge. Scaling uses past training examples only. Four-year half-life weighting is global across historical examples, not a carried team rating. Three seeds average logits; a past-outcome temperature calibrates the resulting probabilities. The historical market teacher changes labels, not features: target = (1−alpha) × winner + alpha × de-vig market probability when available.</p>
<p>Named classical algorithms are explicit equal-start variants in this code. LRMC is a margin-based Markov implementation; it is not the original authors’ published fitted model. Elo estimates its generic venue effect from the available current-season snapshot before replaying the earlier games. All implementations are exposed in models.py for review.</p>'''
    for name,count in counts.items(): methods_body+=f'<h2>{esc(label(name))}: {count} configurations</h2><p>{esc(DESCRIPTIONS[name])}</p>'
    for file,title in [('features.json','28 basic numeric features'),('rich-features.json','64 rich numeric features'),('graph-features.json','152 graph numeric features')]:
        names=read(file);methods_body+=f'<h2>{title}</h2>'+table(pd.DataFrame({'Index':range(len(names)),'Feature':names}))
    methods_body+='''<h2>Prediction dates and evaluation</h2><p>Weekly predictions begin with Week 4 and use Monday 12:00 UTC snapshots. Only games with kickoff plus a six-hour completion allowance before the cutoff can supply features. Postseason games are ordered by actual dates, not their misleading source week labels. Historical frozen Week 6 cutoff is the latest completed regular-season Week 6 kickoff plus six hours; 2026 uses the stored October 11 08:30 UTC snapshot.</p>
<p>Winner accuracy gives a .500 probability half a correct pick. Brier score averages squared probability error; log loss averages negative log probability of the observed winner; lower is better. Margin error is reported when a model has an explicit margin forecast. The season-block bootstrap resamples 20,000 sets of entire seasons with a fixed seed, preserving within-season dependence; few available blocks and adaptive design limit interpretation.</p>
<p>The compact play aggregations exclude garbage-time scrimmage plays above score gaps of 38 in period 2, 28 in period 3, and 22 in period 4 or later. Full-play variants are also tested. Special-team EPA is mirrored so one team’s value is the opponent’s negative. Rich metrics include pass/rush EPA, success, yards, explosives, turnover and sack rates, third-down conversion, EPA excluding turnovers, drive EPA, completion rate, and drive field position. No spread columns in the source data are read into model features.</p>'''
    (HERE/'METHODS.html').write_text(document('Methods and features',methods_body))
    pdf_report(current,selected,market_rows,rounds,freeze_rows,cf,annual,main_accuracy,experiment_networks,annual_networks)
    (OUT/'report-manifest.json').write_text(json.dumps(dict(experimental_settings=config_count,experimental_network_fits=experiment_networks,
        annual_network_fits=annual_networks,total_network_fits=experiment_networks+annual_networks,statistical_configurations=151,
        selected_model='graph_ensemble',selection_years=[2018,2019],weekly_accuracy=main_accuracy),indent=2)+'\n')
    print('Generated REPORT.html, METHODS.html, REPORT.pdf, charts, and summary CSVs',flush=True)

def pdf_report(current,selected,market_rows,rounds,freeze_rows,cf,annual,accuracy,nets,annual_nets):
    styles=getSampleStyleSheet();story=[]
    def paragraph(text,style='BodyText'): story.extend([Paragraph(text,styles[style]),Spacer(1,8)])
    def pdf_table(rows,widths=None):
        wrapped=[[Paragraph(esc(v),styles['BodyText']) for v in row] for row in rows]
        t=Table(wrapped,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7eef6')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#ced9e4'))]));story.extend([t,Spacer(1,12)])
    paragraph('College football: learn from the past, rank from this season','Title')
    paragraph('2026 Week 6 snapshot: October 11, 08:30 UTC. Research completed October 14, 2026.')
    paragraph(f'The selected neural model picks {pct(accuracy)} of 3,603 FBS winners in 2020–2025. It improves conventional baselines, but does not beat archived sportsbook favorites overall. All matched comparisons and downloadable weights are in REPORT.html.')
    paragraph('How historical learning remains preseason agnostic','Heading2')
    paragraph('Each historical example contains only that season’s statistics available before the game, plus the eventual winner label. Shared network weights learn general relationships. In 2026, features use 2026 games only. No team identity, conference, division, talent rating, preseason prior, or carried team strength enters the network. All teams begin equally.')
    paragraph('The selected model averages three seeds of a 64-feature, 8-neuron matchup network and three seeds of a 152-feature, 16-neuron opponent-graph network. Its probability is 75% rich and 25% graph. Neutral rankings sort average win probability against the complete 266-team modeled field.')
    paragraph('Matched betting benchmarks, 2020–2025','Heading2')
    pdf_table([['Benchmark','Games','Neural','Market','Difference']]+[[x['Benchmark'],x['Games'],x['Neural accuracy'],x['Market accuracy'],x['Neural minus market']] for x in market_rows],[1.7*inch,.65*inch,.8*inch,.8*inch,1.4*inch])
    paragraph('Archived quote capture timestamps are unavailable. These prices cannot be certified as opening or closing or as available at the Monday prediction cutoff. This is a prediction comparison, not a profitability test. The later seasons were repeatedly inspected; these are development results, not a pristine holdout. Season-block intervals have only five or six blocks.')
    story.append(Image(str(HERE/'accuracy.png'),width=6.3*inch,height=2.47*inch));story.append(PageBreak())
    paragraph('2026 Week 6 recommended neural ranking','Heading1')
    pdf_table([['Rank','Team','Mean neutral win probability']]+[[int(x['rank']),x['team'],f"{x['score']:.4f}"] for x in current.head(25).to_dict('records')],[.6*inch,3*inch,2*inch])
    paragraph('The full rankings for every method, all 415 statistical/neural configurations, and 791 known future-game forecasts are included in the interactive HTML and CSV exports. The CFP has no official Week 6 2026 list; its first release is scheduled for November 3.')
    story.append(PageBreak());paragraph('Experiments and selection','Heading1')
    paragraph(f'{nets:,} experimental network fits across 264 settings and a convergence check; {annual_nets} annual refits; {nets+annual_nets:,} total saved fits. Also tested 151 configurations across 22 classical families and supervised logistic regression, boosted trees, and randomized trees.')
    pdf_table([list(rounds.columns)]+rounds.values.tolist(),[1.05*inch,.75*inch,1.15*inch,3.4*inch])
    paragraph('Round 1 trains on 2002–2013 and selects on 2014–2019. Rounds 2–4 train on 2006–2017 and select on 2018–2019. Annual model weights use only earlier seasons. Reusing validation during adaptive experimentation limits generalization claims. Before 2020, yearly results are retrospective architecture hindcasts.')
    paragraph('Past market labels did not establish an advantage: the selected market-supervised rank net had 74.18% validation accuracy, falling to 73.67% after a converged longer-training check. Its annual winner accuracy was 70.39%. Validation assigns zero market-supervised weight in the final blend.')
    paragraph('Freeze after Week 6, predict remaining games','Heading2')
    pdf_table([['Method','Games','Accuracy','Log loss']]+[[x['Method'],x['Games'],x['Winner accuracy'],x['Log loss']] for x in freeze_rows],[2.6*inch,.7*inch,1*inch,1*inch])
    paragraph('These use the same 2,703 future FBS games with Week 6 features fixed. Later-game market prices may incorporate information obtained after Week 6, so the weekly market comparison is the primary test.')
    paragraph('CFP higher-ranked-team benchmark','Heading2')
    pdf_table([['Cohort','N','Neural','CFP','Difference']]+[[x['Games'],x['N'],x['Neural accuracy'],x['CFP higher-rank pick'],x['Difference']] for x in cf],[2.1*inch,.5*inch,.8*inch,.8*inch,1.2*inch])
    paragraph('Only lists published before kickoff are eligible; at least one team must be ranked. The CFP committee ranks accomplishments for selection, which differs from predicting winners. A positive CFP comparison does not establish a general sportsbook edge.')
    story.append(PageBreak());paragraph('Selected algorithms: mechanisms, accuracy, Week 6 leaders','Heading1')
    for x in selected:
        paragraph(x['Method'],'Heading2');paragraph(x['How it works'])
        paragraph(f"2020–2025: {x['2020–25 accuracy']}, {x['Games']} games, log loss {x['Log loss']}. Week 6 top five: {x['Week 6 top five']}.")
    story.append(PageBreak());paragraph('Matched annual market comparisons','Heading1')
    a=annual[annual.year.lt(2026)]
    pdf_table([['Year','Benchmark','Games','Neural','Market','Difference']]+[[int(x.year),x.market.replace('_market',''),int(x.games),pct(x.neural_accuracy),pct(x.market_accuracy),f'{100*x.difference:+.2f} pp'] for x in a.itertuples()],[.5*inch,1.2*inch,.6*inch,.8*inch,.8*inch,1.1*inch])
    story.append(Image(str(HERE/'seasons.png'),width=6.3*inch,height=2.36*inch))
    paragraph('Limitations and what would test the next improvement','Heading1')
    paragraph('The model lacks timestamped injuries, player availability, lineup changes, and some play-context information. Play coverage is sparse for early archive years and FCS teams. Historical EPA/success fitting vintages may be retrospective. Compact input dates are audited, but this is not a full reconstruction of contemporaneously downloadable data.')
    paragraph('Add richer timestamped current-season availability and play context, freeze a protocol prospectively, and compare against timestamped sportsbook prices. More parameters, more epochs, or selecting the best later-season configuration cannot by themselves establish a reliable edge.')
    paragraph('These results cover implemented public ranking families, not every known algorithm or private sportsbook, FPI, or SP+ formulas. All source hashes, mathematical implementations, probabilities, weights, and audit exports are saved alongside this report. See METHODS.html for equations and all feature lists, and README.md for commands.')
    SimpleDocTemplate(str(HERE/'REPORT.pdf'),pagesize=(8.5*inch,11*inch),rightMargin=.65*inch,leftMargin=.65*inch,topMargin=.6*inch,bottomMargin=.6*inch,
        title='Season-only college football neural research',author='rank research').build(story)

if __name__ == '__main__': main()
