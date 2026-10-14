"""Build the resume report and an independent Python/TypeScript parity audit."""
import csv
import html
import json
from collections import defaultdict
from pathlib import Path
import numpy as np
from study import HERE, ROOT, load, resumes


def summaries(report):
    rows=[]
    for period,start,end in [('2002–2025',2002,2025),('2014–2019 design',2014,2019),('2021–2025 development',2021,2025)]:
        for snapshot in ['week6','final']:
            for cohort in ['fbs','all']:
                totals=defaultdict(lambda:[0.,0])
                for row in report['standings']:
                    if start<=row['year']<=end and row['snapshot']==snapshot:
                        m=row['agreement'][cohort]
                        totals[row['method']][0]+=m['correct'];totals[row['method']][1]+=m['games']
                for method,(correct,n) in totals.items():
                    rows.append(dict(period=period,snapshot=snapshot,cohort=cohort,method=method,games=n,agreement=correct/n))
    return rows


def main():
    evaluation=json.loads((HERE/'evaluation.json').read_text())
    current=json.loads((HERE/'week6-2026-snapshot.json').read_text())
    protocol=json.loads((HERE/'protocol.json').read_text())
    settings=protocol['selected']
    assert settings==current['manifest']['resume']
    s=load(2026)
    cutoff=__import__('pandas').Timestamp(current['snapshot']['asOf']).timestamp()
    _, independent=resumes(s,s['g'][s['g'].time+21600<=cutoff],settings,receipts=True)
    published={t['id']:t for t in current['teams']}
    parity=[]
    maximum=0.
    for team_id,r in zip(s['ids'],independent):
        if r is None:continue
        t=published[team_id]
        for name in ['score','expectedWins','scheduleDifficulty','recordProbability','benchmarkStrength']:
            difference=abs(r[name]-t['resume'][name]); maximum=max(maximum,difference)
            if difference>1e-6:raise AssertionError((team_id,name,r[name],t['resume'][name]))
        parity.append(dict(id=team_id,score=r['score'],expectedWins=r['expectedWins'],recordProbability=r['recordProbability']))
    (HERE/'python-parity.json').write_text(json.dumps(dict(teams=len(parity),maximumDifference=maximum,rows=parity),indent=2)+'\n')
    summary=summaries(evaluation)
    with (HERE/'historical-summary.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=list(summary[0]));writer.writeheader();writer.writerows(summary)
    selected=[r for r in summary if r['period']=='2021–2025 development' and r['snapshot']=='final' and r['cohort']=='fbs']
    by_method={r['method']:r for r in selected}
    new=by_method['Wins above top-25 benchmark'];old=by_method['Previous frozen-credit v2']
    payload=json.dumps(dict(teams=current['teams'],summary=summary),separators=(',',':')).replace('<','\\u003c')
    intro=f"""<p class="lede">A résumé measures the results a team earned against its schedule. The new standing is <b>actual wins minus the wins a results-based top-25 FBS benchmark would expect against that same schedule</b>.</p>
    <div class="cards"><article><b>{100*new['agreement']:.2f}%</b><span>Completed-result agreement<br>2021–2025 FBS, {new['games']:,} games</span></article><article><b>{100*old['agreement']:.2f}%</b><span>Previous frozen-credit model<br>Identical completed games</span></article><article><b>24 seasons</b><span>Historical comparisons<br>2002–2025</span></article></div>
    <p>These percentages describe how often the final standing places a completed game’s winner above its loser, with ties worth half. They are <b>not future-game accuracy, an objective résumé label, or proof of universal superiority</b>. Colley and Bradley–Terry remain competitive.</p>"""
    document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rank · Results-only résumé study</title>
<style>:root{color-scheme:dark}body{font:16px/1.65 system-ui,sans-serif;background:#0c121b;color:#e4eaf4;max-width:1160px;margin:auto;padding:32px 22px}h1{font-size:clamp(30px,5vw,52px);line-height:1.15}h2{margin-top:38px}a{color:#80c9ff}p{max-width:950px}.eyebrow{color:#8db9e4}.lede{font-size:21px}.cards{display:flex;gap:16px;flex-wrap:wrap}article{background:#172333;border:1px solid #304154;border-radius:12px;padding:20px;flex:1;min-width:200px}article b{font-size:32px;display:block;color:#9ce2c4}article span{color:#b6c4d7}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}th,td{padding:10px;border-bottom:1px solid #2a3849;text-align:right;white-space:nowrap}th:nth-child(2),td:nth-child(2){text-align:left}th:first-child,td:first-child{text-align:left}tr.selected{background:#19352e}select,button{font:inherit;color:inherit;background:#172333;border:1px solid #476076;padding:8px;margin:6px;border-radius:6px}.note{color:#b6c4d7}code{color:#a8dbff}details{border-bottom:1px solid #304154;padding:12px 0}.formula{padding:22px;background:#172333;border-radius:12px;font-size:22px}summary{cursor:pointer}footer{margin-top:40px;border-top:1px solid #304154;padding-top:18px}</style>
<p class="eyebrow">RANK · RÉSUMÉ RESEARCH · 2026-10-13, America/Denver</p><p><b>Archived experiment.</b> The default standings have been restored to the previous frozen-credit ranking. This report preserves the alternative résumé study and its original Week 6 snapshot.</p><h1>Rank the season a team earned.</h1>'''+intro+'''
<h2>The scoring rule</h2><div class="formula">Résumé = Σ (game result − benchmark win probability)</div>
<p>A win has result 1; a loss has result 0. If the benchmark would win 20% of the time, winning earns +0.80 and losing costs −0.20. If it would win 95%, winning earns +0.05 and losing costs −0.95. A score of +1 means one more win than the benchmark expects against that schedule. Playing a difficult schedule without winning cannot create positive credit.</p>
<p>Opponent strength is fit from current-season <b>wins, losses and venues</b> using regularized Bradley–Terry. Every team starts equal. When assessing a team, remove <b>every game involving that team</b>, then fit the opponent ratings and choose the 25th-highest FBS strength as its benchmark. This stops a team’s own results from manufacturing opponent quality. Later opponent results revalue earlier games. Road wins receive more credit than equivalent home wins.</p>
<p>The historical calibration selected ridge <b>0.5</b> and home advantage <b>0.3 log odds</b> from 16 settings on 2014–2019 dated future-game probabilities. These shared settings are the same for all teams. The top-25 reference and additive scoring rule are explicit ranking policies; they were not optimized against the current standings, polls, or later-season outcomes. There are no team or division strength priors, score margins, EPA, recruiting, injuries, betting prices, recency bonuses, or preseason rankings in the résumé.</p>
<h2>2026 · through completed Week 6 games</h2><p class="note">Cutoff: 2026-10-11 08:30 UTC. FBS and FCS share the full-field rank. Filtering preserves those ranks. “Previous” refers to the archived frozen-credit standing.</p>
<label>Division <select id="division"><option value="all">FBS + FCS</option><option value="fbs">FBS</option><option value="fcs">FCS</option></select></label><label>Rows <select id="limit"><option>25</option><option>50</option><option value="999">All</option></select></label>
<div class="scroll"><table><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Wins above benchmark</th><th>Expected wins</th><th>Previous rank</th></tr></thead><tbody id="rankings"></tbody></table></div>
<h2>Explain a team’s résumé</h2><label>Team <select id="team"></select></label><p id="team-note"></p><div class="scroll"><table><thead><tr><th>Game</th><th>Opponent / venue</th><th>Result</th><th>Benchmark win chance</th><th>Other opponent games</th><th>Contribution</th></tr></thead><tbody id="receipts"></tbody></table></div>
<h2>Historical method comparison</h2><p>All methods use the same completed-game cohort within each season and snapshot. Week 6 compares the results completed by that snapshot; final includes the completed postseason. These are descriptive consistency comparisons. A résumé can reasonably favor a better overall season despite a head-to-head loss.</p>
<label>Seasons <select id="period"><option>2021–2025 development</option><option>2002–2025</option><option>2014–2019 design</option></select></label><label>Snapshot <select id="snapshot"><option value="final">Final</option><option value="week6">Week 6</option></select></label><label>Games <select id="cohort"><option value="fbs">FBS vs FBS</option><option value="all">All modeled FBS/FCS</option></select></label>
<div class="scroll"><table><thead><tr><th>Method</th><th>Agreement</th><th>Games</th></tr></thead><tbody id="comparison"></tbody></table></div>
<h2>What is better, and what remains uncertain</h2><ul><li>Wins update when opponents establish a stronger or weaker current-season résumé.</li><li>Losses account for opponent and venue rather than costing an identical point.</li><li>Flipping a team’s loss into a win, with the same schedule and other results, increases its score by exactly one. Its benchmark probabilities are unchanged because all its games are excluded from the fit.</li><li>Running up the score cannot improve a résumé; changing only margins leaves every résumé unchanged.</li><li>The per-game receipts sum exactly to the score. Python and TypeScript independently reproduce the current standings.</li></ul>
<p>Early disconnected schedules and sparse opponent records remain uncertain. Equal priors deliberately avoid assuming an FCS opponent is weak before current-season results provide evidence. An opponent with fewer than three independent modeled results triggers the limited-evidence flag. Supporting opponents outside the modeled field earn zero win credit and cost one for a loss; their quality cannot be estimated reliably from the available field.</p>
<p>The record-probability diagnostic is a Poisson-binomial chance that the benchmark matches or exceeds the observed win total. It assumes conditionally independent games, does not integrate rating uncertainty, and is not a confidence level. It is displayed for interpretation and compared as an alternative ranking, but is not the selected score.</p>
<p>All historical seasons have been inspected in this project. The 2002–2025 comparison is retrospective development, not a pristine holdout. The previous model’s 2014–2019 division calibration also postdates 2002–2013. Historical snapshots use a six-hour completion lag and actual kickoff dates; they do not certify historical publication vintages. There is no objective ground-truth résumé ranking. A new ranking can satisfy clearer earned-results policies without proving it is best at predicting future games.</p>
<p>The separate results-only strength fit predicted winners on '''+f"{evaluation['predictionMetrics']['games']:,} dated FBS games at {100*evaluation['predictionMetrics']['accuracy']:.2f}% accuracy (2002–2025 retrospective; log loss {evaluation['predictionMetrics']['logLoss']:.4f}). This evaluates the opponent-strength component, not the résumé ordering. The original neural forecasts remain a separate predictive study and are not relabeled as résumé quality."+'''
</p><footer><a href="REPORT.pdf">PDF report</a> · <a href="README.md">Methods and reproduction</a> · <a href="week6-2026-rankings.csv">Complete Week 6 CSV</a> · <a href="historical-summary.csv">Historical summary</a> · <a href="protocol.json">Calibration protocol</a> · <a href="evaluation.json">Season results and input hashes</a> · <a href="audit-2026.json">Current audit</a> · <a href="python-parity.json">Independent parity check</a></footer>
<script>const DATA='''+payload+''';
const $=id=>document.getElementById(id);const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const fixed=(v,n=3)=>Number(v).toFixed(n);const cell=s=>'<td>'+escape(s)+'</td>';const teamMap=new Map(DATA.teams.map(t=>[t.id,t]));
function rankings(){const ts=DATA.teams.filter(t=>t.resume&&($('division').value==='all'||t.classification===$('division').value)).slice(0,+$('limit').value);$('rankings').innerHTML=ts.map(t=>'<tr>'+[t.rank,t.school,t.wins+'–'+t.losses,fixed(t.height),fixed(t.resume.expectedWins,2),t.earnedRank].map(cell).join('')+'</tr>').join('')}
function receipts(){const t=teamMap.get(+$('team').value),r=t.resume;$('team-note').textContent=t.school+': '+t.wins+' wins, '+fixed(r.expectedWins,2)+' expected; résumé '+fixed(r.score)+'. Benchmark chance of matching or exceeding this record: '+fixed(100*r.recordProbability,1)+'%.';$('receipts').innerHTML=r.games.map(g=>'<tr>'+[g.gameId,(g.where===-1?'at ':g.where===0?'neutral · ':'home · ')+(teamMap.get(g.opponentId)?.school??'Supporting opponent '+g.opponentId),g.won?'W':'L',fixed(100*g.benchmarkWinProbability,1)+'%',g.opponentGames,fixed(g.value)].map(cell).join('')+'</tr>').join('')}
function comparison(){const rows=DATA.summary.filter(r=>r.period===$('period').value&&r.snapshot===$('snapshot').value&&r.cohort===$('cohort').value).sort((a,b)=>b.agreement-a.agreement);$('comparison').innerHTML=rows.map(r=>'<tr'+(r.method==='Wins above top-25 benchmark'?' class="selected"':'')+'>'+[r.method,fixed(100*r.agreement,2)+'%',r.games].map(cell).join('')+'</tr>').join('')}
for(const t of DATA.teams.filter(t=>t.resume)){$('team').add(new Option('#'+t.rank+' '+t.school,t.id))}for(const id of ['division','limit'])$(id).onchange=rankings;$('team').onchange=receipts;for(const id of ['period','snapshot','cohort'])$(id).onchange=comparison;rankings();receipts();comparison();
</script></html>'''
    (HERE/'REPORT.html').write_text(document)
    pdf_report(current,selected,evaluation)
    print(json.dumps(dict(parityTeams=len(parity),maximumDifference=maximum,newAgreement=new['agreement'],oldAgreement=old['agreement'])),flush=True)


def pdf_report(current,comparison,evaluation):
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    styles=getSampleStyleSheet(); story=[]
    def p(text,style='BodyText'):
        story.append(Paragraph(text,styles[style]));story.append(Spacer(1,9))
    def table(rows,widths=None):
        t=Table(rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e6edf6')),('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),('FONTSIZE',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#c4ccda'))]))
        story.append(t);story.append(Spacer(1,12))
    p('Rank the season a team earned','Title')
    p('<b>Archived experiment.</b> The default standings use the previous frozen-credit ranking. This report preserves the alternative résumé study.')
    p('Results-only résumé research · 2026-10-13 · America/Denver')
    p('<b>Résumé = actual wins minus the wins a top-25 benchmark expects against the same schedule.</b> A difficult win earns more; a bad loss costs more. Road results account for venue. Later opponent results revalue earlier games.')
    p('Opponent quality is regularized Bradley–Terry from current-season wins, losses and venues. Remove all focal-team games before fitting its opponents and the reference. All teams start equal. Ridge 0.5 and home advantage 0.3 log odds were calibrated on dated 2014–2019 future-game probabilities. Benchmark rank 25 and additive scoring are declared policies. There are no team/division priors, margins, polls, EPA, betting prices, or preseason rankings in the résumé.')
    p('Historical comparison: 2021–2025 final FBS standings','Heading2')
    table([['Method','Result agreement','Games']]+[[r['method'],f"{100*r['agreement']:.2f}%",str(r['games'])] for r in sorted(comparison,key=lambda r:-r['agreement'])],[310,100,65])
    p('Agreement places a completed game’s winner above its loser, with ties worth half. It is descriptive consistency, not future prediction, objective résumé ground truth, or proof of superiority. Colley and Bradley–Terry remain competitive. The full HTML report covers seven methods, Week 6/final snapshots, FBS/all modeled games, and 24 seasons from 2002–2025.')
    p(f"The separate results-only strength component predicted winners on {evaluation['predictionMetrics']['games']:,} dated FBS games at {100*evaluation['predictionMetrics']['accuracy']:.2f}% accuracy. This does not measure résumé ordering. Neural prediction models remain separate.")
    story.append(PageBreak())
    p('2026 · through completed Week 6','Title')
    p('Cutoff: 2026-10-11 08:30 UTC. Combined FBS/FCS field; original full-field ranks.')
    table([['Rank','Team','Record','Above benchmark','Previous rank']]+[[str(t['rank']),t['school'],f"{t['wins']}-{t['losses']}",f"{t['height']:.3f}",str(t['earnedRank'])] for t in current['teams'][:25]],[35,180,50,115,80])
    p('The interactive report includes all 266 teams and every per-game receipt. The original frozen-credit standing is retained as earnedHeight/earnedRank. Legacy projections explicitly target frozen earned points; they are not forecasts of this résumé rank.')
    story.append(PageBreak())
    p('Integrity and limits','Title')
    p('Flipping a loss to a win on the same schedule increases a team’s résumé by exactly one, without changing its benchmark probabilities. Margin-only changes leave every résumé unchanged. Road wins receive more credit than equivalent home wins. Receipts sum to each score. Independent Python and TypeScript implementations reproduce the current standings.')
    p('Early schedules are sparse and sometimes disconnected. Equal priors avoid imposing a division hierarchy, but cannot supply missing evidence. Opponents with fewer than three independent modeled results trigger a limited-evidence flag. Supporting opponents outside the modeled field receive zero quality credit for wins and a full loss cost.')
    p('Record probability is a Poisson-binomial diagnostic: the chance a benchmark matches or exceeds the observed win total. Conditional game independence is assumed; rating uncertainty is not integrated. It is not the selected score or a confidence level.')
    p('All historical seasons have been inspected. The comparisons are retrospective development, not pristine holdouts. The archived v2 calibration postdates 2002–2013. Score availability is approximated as six hours after kickoff; historical publication vintages are not certified. No objective ground-truth résumé ranking exists, and no universal or market-beating claim follows from these comparisons.')
    p('Reproduction','Heading2')
    for line in ['OPENBLAS_NUM_THREADS=1 python research/resume/study.py calibrate','OPENBLAS_NUM_THREADS=1 python research/resume/study.py evaluate','OPENBLAS_NUM_THREADS=1 python research/resume/compare_legacy.py','npm run compute','npm run audit-resume -- 2026','OPENBLAS_NUM_THREADS=1 python research/resume/report.py','npm run typecheck; npm test; npm run verify; npm run build']:
        p(html.escape(line),'Code')
    SimpleDocTemplate(str(HERE/'REPORT.pdf'),rightMargin=45,leftMargin=45,topMargin=42,bottomMargin=42).build(story)


if __name__=='__main__':main()
