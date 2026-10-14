"""Publish the four-improvement study from saved models and exact probabilities."""
import html
import json
from datetime import datetime
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,Image,PageBreak
from common import HERE,OUT,PARENT
from report import STYLE,document,table,pct

def read(name):return json.loads((OUT/name).read_text())
def escaped(value):return html.escape(str(value))

def plots(pred):
    old=pd.read_csv(PARENT/'results/predictions.csv.gz',low_memory=False)
    old=old[['year','game_id','mode','p_spread_market']]
    p=pred.merge(old,on=['year','game_id','mode'],validate='one_to_one')
    p=p[(p['mode']=='weekly')&p.fbs&p.year.between(2020,2025)&p.p_spread_market.notna()]
    from evaluate import metrics
    plt.rcParams.update({'font.size':11,'axes.spines.top':False,'axes.spines.right':False})
    fig,axs=plt.subplots(1,3,figsize=(13,4.2),constrained_layout=True)
    for ax,title,mask in zip(axs,['All matched games','Weeks 4–6','Regular season, Week 7+'],
        [np.ones(len(p),bool),~p.postseason&p.week.between(4,6),~p.postseason&p.week.ge(7)]):
        q=p[mask];values=[metrics(q.y,q[n])['accuracy']*100 for n in ['p_v1_recommended','p_v2_recommended','p_spread_market']]
        ax.bar(['V1','V2','Market'],values,color=['#8fa9bf','#176d91','#ba713d']);ax.set_ylim(55,80)
        ax.set_title(f'{title}\n{len(q):,} identical games');ax.set_ylabel('Winner accuracy (%)')
        for i,v in enumerate(values):ax.text(i,v+.4,f'{v:.2f}',ha='center')
    fig.savefig(HERE/'comparison.png',dpi=180);plt.close(fig)
    annual=pd.read_csv(OUT/'season-metrics.csv');annual=annual[(annual['mode']=='weekly')&annual.year.between(2007,2025)]
    fig,ax=plt.subplots(figsize=(11,4),constrained_layout=True)
    for name,color,label in [('v1_recommended','#8fa9bf','V1 recommendation'),('v2_recommended','#176d91','V2 recommendation')]:
        d=annual[annual.method.eq(name)];ax.plot(d.year,d.accuracy*100,'o-',color=color,label=label)
    ax.axvspan(2006.5,2019.5,color='#e7eef6',alpha=.5);ax.set_xticks(range(2007,2026));ax.tick_params(axis='x',rotation=45)
    ax.set(xlabel='Season (earlier periods include architecture hindcasts)',ylabel='Winner accuracy (%)',title='Annual fits: every weight fit ends before its forecast season')
    ax.legend();fig.savefig(HERE/'seasons.png',dpi=180);plt.close(fig)

def main():
    report=read('evaluation.json');selection=read('selection.json');blend=read('blend-selection.json');pilot=read('availability-pilot.json')
    sources=read('market-sources.json');injuries=read('availability-source-audit.json');lock=read('prospective-registration.json')
    phases=pd.read_csv(OUT/'phase-metrics.csv');rank=pd.read_csv(OUT/'week6-2026-rankings.csv');pred=pd.read_csv(OUT/'predictions.csv.gz')
    plots(pred)
    full=phases[(phases.phase=='all')&phases.method.isin(['v1_recommended','v2_recommended','v2_rich','v2_context','v2_full','v2_graph_context'])]
    phase_rows=[]
    for phase in ['all','weeks_4_6','either_team_at_most_five_games','regular_week_7_onward','postseason']:
        d=phases[phases.phase.eq(phase)].set_index('method')
        phase_rows.append({'Period':phase.replace('_',' '),'Games':int(d.loc['v2_recommended','games']),
            'V1 accuracy':pct(d.loc['v1_recommended','accuracy']),'V2 accuracy':pct(d.loc['v2_recommended','accuracy']),
            'Change':f"{100*(d.loc['v2_recommended','accuracy']-d.loc['v1_recommended','accuracy']):+.2f} points",
            'V1 log loss':f"{d.loc['v1_recommended','log_loss']:.4f}",'V2 log loss':f"{d.loc['v2_recommended','log_loss']:.4f}"})
    market_rows=[]
    for market in ['spread_market','moneyline_market']:
        d=report['paired']['p_v2_recommended:vs:p_'+market]
        market_rows.append({'Benchmark':market.replace('_',' '),'Games':d['model']['games'],
            'V2 accuracy':pct(d['model']['accuracy']),'Market accuracy':pct(d['benchmark']['accuracy']),
            'Difference':f"{100*d['comparison']['accuracy_difference']:+.2f} points",
            '95% season interval':' to '.join(f'{100*v:+.2f}' for v in d['comparison']['accuracy_95_interval'])+' points'})
    strict_rows=[]
    for r in report['timestamped_2026']:
        strict_rows.append({'Market':r['market'],'Maximum quote age':str(r['max_age_hours'])+' hours','Games':r['games'],
            'V1 accuracy':pct(r['models']['v1_recommended']['accuracy']),'V2 accuracy':pct(r['models']['v2_recommended']['accuracy']),
            'Market accuracy':pct(r['benchmark']['accuracy'])})
    strict_primary=next(r for r in report['timestamped_2026'] if r['market']=='moneyline' and r['max_age_hours']==24)
    strict_variants=[dict(Model=name,Games=strict_primary['games'],Accuracy=pct(d['accuracy']),
        Brier=f"{d['brier']:.4f}",Log_loss=f"{d['log_loss']:.4f}") for name,d in strict_primary['models'].items()]
    strict_variants.append(dict(Model='moneyline_market',Games=strict_primary['games'],Accuracy=pct(strict_primary['benchmark']['accuracy']),
        Brier=f"{strict_primary['benchmark']['brier']:.4f}",Log_loss=f"{strict_primary['benchmark']['log_loss']:.4f}"))
    from scipy.stats import binomtest
    quotes=pd.read_csv(OUT/'matched-quote-audit.csv');quotes=quotes[quotes.market.eq('moneyline')&quotes.max_age_hours.eq(24)]
    same=pred[(pred['mode']=='weekly')&pred.fbs&pred.year.eq(2026)].merge(quotes[['game_id','value']],on='game_id',validate='one_to_one')
    same=same[~np.isclose(same.value,.5)&~np.isclose(same.p_v2_rich,.5)]
    nh=same.p_v2_rich.gt(.5).eq(same.y.gt(0));mh=same.value.gt(.5).eq(same.y.gt(0))
    win=int((nh&~mh).sum());loss=int((mh&~nh).sum());pvalue=float(binomtest(win,win+loss,.5).pvalue) if win+loss else 1.
    (OUT/'timestamped-rich-paired-test.json').write_text(json.dumps(dict(games=len(same),neural_only_correct=win,market_only_correct=loss,
        exact_two_sided_mcnemar_p=pvalue,interpretation='Descriptive comparison among multiple preselected variants on a small replay cohort; not a prospective superiority claim.'),indent=2)+'\n')
    variant_rows=[]
    per_feature=read('feature-selections.json')
    for feature,dimensions,description in [('rich',64,'Prior score and play summaries; new specialist training.'),
        ('context',112,'Adds 40 situation/drive ratings and eight evidence/uncertainty signals.'),
        ('full',152,'Adds 16 player-production/continuity signals and 24 ordered game-history signals.'),
        ('graph_context',240,'Combines the previous opponent graph with every new signal.')]:
        d=full[full.method.eq('v2_'+feature)].iloc[0];c=per_feature[feature]
        variant_rows.append({'Variant':feature,'Numeric features':dimensions,'Mechanism':description,
            'Expert blend alpha':c['alpha'],'Validation macro accuracy':pct(c['validation']['macro_season_accuracy']),
            '2020–25 accuracy':pct(d.accuracy),'Log loss':f'{d.log_loss:.4f}'})
    chosen=selection['chosen'];today=datetime.now(ZoneInfo('America/Denver')).date().isoformat()
    body=f'''<nav><a href="REPORT.pdf">Printable PDF</a><a href="README.md">Reproduction and commands</a><a href="../REPORT.html">Original full study</a><a href="results/week6-2026-rankings.csv">Ranking CSV</a></nav>
<h1>Four improvements to the season-only neural ranker</h1><p class="muted">Research date: {today} (America/Denver). Statistical snapshot: completed 2026 Week 6 games.</p>
<p>This study implements an early-season specialist, player availability, richer game context, and stricter chronological evaluation. It preserves equal starts and numeric current-season team inputs. Historical outcomes teach shared weights; team and player identifiers resolve joins only.</p>
<h2>What changed and what the evidence supports</h2>'''
    body+=table(pd.DataFrame(variant_rows))
    body+=f'''<p>The selected foundation is <strong>{escaped(chosen['settings']['feature_set'])}</strong>: a shared {chosen['settings']['width']}-neuron {escaped(chosen['settings']['kind'])} network for season-wide strength and another for low-evidence games, each averaged over three seeds. The selected specialist alpha is {chosen['alpha']}. A separate older-fold check of V1/V2 combinations chose {blend['chosen']['v2_weight']:.0%} V2 with a {escaped(blend['chosen']['gate'])} blend.</p>
<p>Feature variants are compared using the same later-season games. Adding player or graph features is an experiment, not an automatic improvement. The selected foundation excludes player-production inputs because the older chronological folds did not support those larger variants. Availability adjustments are implemented and evaluated with the full model variant; they are not silently added to the selected context model.</p>
<h2>Historical development results</h2>'''
    body+=table(pd.DataFrame(phase_rows))+'<p>These use identical games for V1 and V2. “At most five games” uses the actual smaller pregame game count of the two teams, so delayed-start seasons are handled by evidence rather than week number. Log loss evaluates probability quality; lower is better. The earlier years and 2020–2025 seasons have been inspected during research, so none is newly untouched.</p>'
    body+='<img class="plot" src="comparison.png" alt="V1, V2, and market winner accuracy on matched historical cohorts"><h2>Archived market benchmarks, 2020–2025</h2>'
    body+=table(pd.DataFrame(market_rows))+'<p>The older quote archive has no capture clock. Those comparisons remain retrospective benchmarks with unequal information-time uncertainty. The intervals resample entire seasons, with only five or six season blocks; adaptive model selection adds uncertainty beyond those intervals.</p>'
    body+='<h2>New: actual quote-time matching in 2026</h2>'+table(pd.DataFrame(strict_rows))
    body+='<h3>All variants on the primary 24-hour moneyline cohort</h3>'+table(pd.DataFrame(strict_variants))
    body+=f'<p>The rich-input specialist has the highest observed hit rate in this small cohort, but worse probability scores than the market. Its exact paired comparison has two-sided p = {pvalue:.3f} ({win} neural-only correct, {loss} market-only correct, excluding tied choices). This does not establish a reliable market edge, and it does not replace the older-fold selected model after seeing these results.</p>'
    body+=f'''<p>The public source contains {sources['eligible_rows']:,} eligible quote rows after screening, covering {sources['games']} games including future fixtures. Its source commit and file hashes are saved. Quotes must be observed, captured, and available before the exact Monday forecast cutoff; older observations do not become fresh merely because they were re-ingested. One sportsbook gets one vote across vendors. Sides must come from the same book, source, and exact capture. Inferred top-ups, live/post-kickoff captures, invalid prices, missing times, and unmatched participant orientation are excluded.</p>
<p>Only a small 2026 replay cohort has qualifying public timestamped quotes. The 24- and 72-hour freshness rules are fixed, and the larger cap is a sensitivity analysis rather than an opportunity to choose a more flattering score. Source timestamps are public third-party assertions, not independently certified bookmaker clocks. No long historical timestamped comparison is claimed. Source: <a href="https://github.com/{sources['repository']}/tree/{sources['revision']}">public capture archive</a>.</p>
<h2>1. Early-season specialist</h2><p>Let n be the smaller completed-game count of the two teams. The expert gate is g = sigmoid((5−n)/1.5). Historical early-expert examples get weights 0.1+0.9g; both experts also use a four-year historical half-life. Forecast probability is (1−alpha×g)×global + alpha×g×early. The gate treats both teams symmetrically and never uses identity or preseason strength. Both networks assign an identical neutral empty snapshot a .500 probability.</p>
<h2>2. Player availability and current-season production</h2>
<p>The importer accepts explicit publication/availability times, effective intervals, season, team, target game when relevant, status, player join, and source. Events from later dates, other seasons, different games, or expired intervals cannot enter a forecast. Missing reports remain unknown. The injury snapshot audit rejected {injuries['rejected_stale_or_undated']} of {injuries['rows']} stale or undated source records; a new snapshot date does not refresh a years-old injury note.</p>
<p>Player features summarize current-season quarterback usage, latest-QB performance, replacement performance with equal shrinkage, rushing/receiving concentration, absent recent production, and continuity. Athlete IDs reconcile PBP spelling changes. Only numeric summaries reach the network. For a supported full-model forecast, published absences alter expected production and replacement mix; already absent players receive no repeated penalty. Unsupported positions and ambiguous player joins are audited, not assigned invented values. Probable/questionable/doubtful weights are nominal scenario assumptions, with available/out endpoints exposed; they are not a fitted medical forecast.</p>
<p>The public integration pilot contains {pilot['actual_report_events']} sourced events from {pilot['source_urls']} articles, producing {pilot['games']} game comparisons and {pilot['changed_forecasts']} changed probabilities. Its winner accuracies are {pct(pilot['baseline']['accuracy'])} before and {pct(pilot['with_availability']['accuracy'])} after adjustment. <strong>This hand-selected pilot is not representative and cannot establish a general injury-data edge.</strong> It exercises the actual neural prediction path. Dated articles with no precise publication clock become available after the end of that publication day; no exact intra-day time is invented.</p>
<p><a href="results/availability-pilot-predictions.csv">Actual before/after predictions</a> · <a href="results/availability-join-audit.csv">Player join audit</a> · <a href="results/availability-pilot-sources.json">Primary announcements and reporting sources</a>. Complete, timestamped historical availability coverage remains a data limitation with public sources.</p>
<h2>3. Richer context and ordered games</h2><p>The new context ratings separate offense and defense in early-down passing/rushing, third-and-long conversion, short-yardage conversion, long-distance EPA, red-zone success, backed-up offense, neutral-score situations, late close situations, passing/rushing downs, first down, and fourth down. Drive features cover finishing points in the red zone and inside the 40, points per drive, net yards, positive-EPA drives, turnovers, and pace. Fits adjust for opponents and venue using completed games only.</p>
<p>Eight evidence signals capture opponent game counts, distinct opponents, schedule connectivity, margin and EPA variability, context coverage, high-leverage sample size, and time since the last game. Ordered histories contain eight numeric signals for each of the latest three games. These are fixed ordered features learned by the shared network, not a falsely labeled recurrent network.</p>
<h2>4. Chronological selection and a prospective lock</h2><p>Settings are selected across three folds: 2006–2013→2014–2015, 2006–2015→2016–2017, and 2006–2017→2018–2019. There are 32 configurations, three seeds for each global/early expert, and three folds: 576 valid final-search fits. The initial selection balances macro-season overall and low-evidence winner accuracy; ties use log loss. The extra V1/V2 blend check prioritizes macro-season overall accuracy. Both protocols were recorded before reading V2 later-season results.</p>
<p>Annual variants are refit using only earlier seasons for 2007–2026. Every team’s statistical inputs reset annually. Source hashes and validation probabilities for every configuration are saved. Validation is reused during development and therefore can itself be overfit; chronological splitting alone does not manufacture an untouched test set.</p>
<p>The prospective registration was issued at {escaped(pd.Timestamp(lock['issued_at']).tz_convert('America/Denver').isoformat())} (America/Denver). It freezes {len(lock['forecasts'])} genuinely future games, model and feature hashes, the Week 6 statistical state, available reports, timely market prices, metrics, and grading rules. Games already started at issuance cannot qualify. The registry refuses overwrite and the grader requires sourced final scores observed after the completion allowance. There is no prospective accuracy result yet.</p>
<p>The original registration is preserved. A separate <a href="results/prospective-market-addendum.json">benchmark-only addendum</a>, recorded before the first registered game, corrects sportsbook case aliases and unverifiable raw-file references. All model forecasts remain unchanged; corrected quotes are still bounded at original issuance. The original quote input and market code are retained for audit.</p>
<p><a href="results/prospective-registration.json">Immutable registration</a> · <a href="results/prospective-forecasts.csv">Issued forecasts</a> · <a href="results/protocol.json">Search protocol</a> · <a href="results/blend-protocol.json">Blend protocol</a>.</p>
<h2>2026 Week 6 rankings</h2><p>Scores are average predicted neutral-site win probability against all modeled FBS/FCS teams. Field selection only filters the output and is not a neural input. Matchup-specific availability reports apply only to their named game; neutral rankings may use applicable season-wide reports known at the snapshot.</p>
<label>Model <select id="model"></select></label><label>Field <select id="field"><option value="fbs">FBS</option><option value="fbs_fcs">FBS + FCS</option></select></label><label>Rows <select id="limit"><option>25</option><option>10</option><option>138</option><option>266</option></select></label>
<div class="scroll"><table><thead><tr><th>Rank</th><th>Team</th><th>Mean win probability</th></tr></thead><tbody id="ranking"></tbody></table></div>
<h2>Every historical season</h2><img class="plot" src="seasons.png" alt="Historical V1 and V2 accuracy by season"><p><a href="results/season-metrics.csv">Per-season accuracy, Brier score, and log loss</a> · <a href="results/predictions.csv.gz">Exact game probabilities</a> · <a href="results/phase-metrics.csv">Phase diagnostics</a> · <a href="results/matched-quote-audit.csv">Which timestamped quotes qualified</a>.</p>
<h2>Scope of the finding</h2><p>These experiments evaluate implemented models and data. They do not establish superiority over every published or private football model. Historical EPA fitting vintages are still unknown, and the availability archive is incomplete. The correct next evidence is the registered future cohort, graded without changing its model or selecting a convenient subset after outcomes arrive.</p>'''
    payload=json.dumps(rank.to_dict('records'),separators=(',',':')).replace('</','<\\/')
    script='<script id="data" type="application/json">'+payload+'''</script><script>
const rows=JSON.parse(document.getElementById('data').textContent),select=document.getElementById('model');
for(const name of [...new Set(rows.map(r=>r.method))]){const o=document.createElement('option');o.value=name;o.textContent=name;select.append(o)}select.value='v2_recommended';
function render(){const body=document.getElementById('ranking');body.replaceChildren();for(const r of rows.filter(r=>r.method===select.value&&r.field===document.getElementById('field').value).sort((a,b)=>a.rank-b.rank).slice(0,+document.getElementById('limit').value)){const tr=document.createElement('tr');for(const value of [r.rank,r.team,Number(r.score).toFixed(4)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}body.append(tr)}}for(const id of ['model','field','limit'])document.getElementById(id).addEventListener('change',render);render();</script>'''
    (HERE/'REPORT.html').write_text(document('Four improvements to the season-only neural ranker',body,script))
    pdf(today,phase_rows,market_rows,strict_rows,variant_rows,pilot,lock,rank,strict_variants,pvalue)
    print('Published V2 HTML/PDF reports and figures',flush=True)

def pdf(today,phase_rows,market_rows,strict_rows,variant_rows,pilot,lock,rank,strict_variants,pvalue):
    styles=getSampleStyleSheet();story=[]
    def p(text,style='BodyText'):story.extend([Paragraph(text,styles[style]),Spacer(1,8)])
    def t(rows,widths):
        wrapped=[[Paragraph(escaped(v),styles['BodyText']) for v in r] for r in rows]
        obj=Table(wrapped,colWidths=widths,repeatRows=1,hAlign='LEFT');obj.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e7eef6')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#ced9e4'))]));story.extend([obj,Spacer(1,10)])
    p('Four improvements to the season-only neural ranker','Title');p('Research date '+today+' (America/Denver). See REPORT.html for every export and source.')
    p('The study implements an early-season expert, availability ingestion and production-based adjustments, richer game-context features, and a stricter chronological/quote-time evaluation. Historical games teach shared weights; forecast inputs remain current-season only. Identities resolve joins and are never embeddings.')
    p('Historical development results','Heading2')
    t([['Period','Games','V1','V2','Change']]+[[r['Period'],r['Games'],r['V1 accuracy'],r['V2 accuracy'],r['Change']] for r in phase_rows],[2.2*inch,.65*inch,.65*inch,.65*inch,1.1*inch])
    story.append(Image(str(HERE/'comparison.png'),width=6.3*inch,height=2.04*inch))
    p('These seasons have been inspected. They remain retrospective development evidence. Lower log loss means better probabilities; all exact scores and phase cohorts are in the HTML and CSVs.')
    p('Archived market comparison','Heading2');t([['Market','Games','V2','Market','Difference']]+[[r['Benchmark'],r['Games'],r['V2 accuracy'],r['Market accuracy'],r['Difference']] for r in market_rows],[1.7*inch,.7*inch,.8*inch,.8*inch,1.2*inch])
    p('The old archive has no capture times. Those results do not establish equal-information-time trading performance. Season-block intervals have only five or six blocks.')
    story.append(PageBreak());p('Timestamp-matched 2026 replay','Heading1')
    t([['Market','Max age','N','V1','V2','Market']]+[[r['Market'],r['Maximum quote age'],r['Games'],r['V1 accuracy'],r['V2 accuracy'],r['Market accuracy']] for r in strict_rows],[1*inch,1.1*inch,.5*inch,.8*inch,.8*inch,.8*inch])
    p('Quotes must be observed, captured, and available at or before the model cutoff. Sides must match the exact capture and sportsbook. One sportsbook gets one vote across vendors. Live/post-kickoff, inferred, stale, ambiguous, and invalid quotes are excluded. This is a small public 2026 replay, not an untouched prospective trial or a long historical closing-line archive.')
    p('All variants on the primary moneyline cohort','Heading2')
    t([['Model','N','Accuracy','Brier','Log loss']]+[[r['Model'],r['Games'],r['Accuracy'],r['Brier'],r['Log_loss']] for r in strict_variants],[2.3*inch,.5*inch,.9*inch,.8*inch,.8*inch])
    p(f'The rich-input specialist has a higher point hit rate than the market here, but worse probability scores. Exact paired p = {pvalue:.3f}. The small replay does not establish a reliable market edge or justify changing the registered selection after outcomes.')
    p('Models and chronological selection','Heading2')
    for r in variant_rows:p(f"<b>{r['Variant']}</b> ({r['Numeric features']} features): {escaped(r['Mechanism'])} 2020–2025 accuracy {r['2020–25 accuracy']}; log loss {r['Log loss']}.")
    p('Folds: 2006–2013 trains 2014–2015 validation; 2006–2015 trains 2016–2017; 2006–2017 trains 2018–2019. All annual weights use earlier seasons. There are 32 configurations, three folds, two experts, and three seeds: 576 valid final-search fits. Validation reuse can overfit model selection.')
    p('Early-season expert','Heading2');p('The gate is sigmoid((5 − smaller team game count)/1.5). Historical examples with limited evidence receive larger weight in the early expert. Probability blends the global and early experts according to the gate. Every neutral empty snapshot starts at .500.')
    p('Context and sequences','Heading2');p('Opponent-adjusted situation and drive ratings cover down/distance, red-zone and backed-up offense, close-score states, drive finishing, turnovers, and pace. Evidence features measure sample size, schedule connectivity, uncertainty, and recency. Full variants add current-season player continuity and three ordered games. Ordered features are not described as a recurrent network.')
    story.append(PageBreak());p('Availability: implemented with limited public coverage','Heading1')
    p(f"The sourced pilot contains {pilot['actual_report_events']} events from {pilot['source_urls']} articles and {pilot['games']} game comparisons. It changed {pilot['changed_forecasts']} probabilities. Winner accuracy was {pct(pilot['baseline']['accuracy'])} before and {pct(pilot['with_availability']['accuracy'])} after adjustment. This hand-selected pilot tests integration and cannot estimate population benefit.")
    p('Every report needs season, team/player join, publication and availability times, effective interval, target game when applicable, status, and provenance. Day-only sources become available after the end of their publication day. Stale prior-year injury notes are rejected. Unreported players remain unknown, ambiguous joins are rejected, and unsupported positions receive no invented impact.')
    p('Adjustments use current-season production and replacement performance. Players already absent from recent usage receive no repeated penalty. Uncertain status probabilities are nominal scenario assumptions with available/out endpoints. Availability works in the full model variants; the selected context model excludes these player inputs because the older folds did not support the larger variants.')
    p('Prospective registration','Heading2');p(f"Issued at {escaped(pd.Timestamp(lock['issued_at']).tz_convert('America/Denver').isoformat())}. The registry freezes {len(lock['forecasts'])} genuinely future fixtures, weights, a portable feature snapshot, current Week 6 statistics, known reports, timely prices, and grading rules. It refuses overwrite. The grader rejects pre-issuance games and premature or unsourced scores. No prospective result exists yet.")
    p('A benchmark-only addendum recorded before registered games begin normalizes sportsbook case aliases and excludes unverifiable raw-file references. It preserves original forecasts, quotes, and code. Corrected prices still use the original issuance cutoff; no model forecast changed.')
    p('Reproduction','Heading2');p('README.md lists the preparation, training, evaluation, inference, source imports, and grading commands. REPORT.html links all checkpoints, exact probabilities, source hashes, and validation records. Complete timestamped historical injury coverage and historical EPA fitting vintages remain limitations.')
    story.append(PageBreak());p('2026 Week 6 recommended ranking','Heading1')
    d=rank[rank.method.eq('v2_recommended')&rank.field.eq('fbs')].sort_values('rank').head(25)
    t([['Rank','Team','Mean neutral win probability']]+[[int(r['rank']),r['team'],f"{r['score']:.4f}"] for r in d.to_dict('records')],[.6*inch,3.5*inch,1.7*inch])
    p('Each team is evaluated against the same complete modeled field. Every feature variant’s FBS and combined FBS/FCS rankings are available in the HTML and CSV. Ranking scores and matchup forecasts answer a predictive question, not earned accomplishments.')
    SimpleDocTemplate(str(HERE/'REPORT.pdf'),pagesize=(8.5*inch,11*inch),leftMargin=.65*inch,rightMargin=.65*inch,topMargin=.6*inch,bottomMargin=.6*inch,
        title='Four improvements to the college football neural ranker',author='rank research').build(story)

if __name__=='__main__':main()
