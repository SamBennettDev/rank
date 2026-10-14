"""Exercise actual dated announcements through the full neural prediction path.

This intentionally selected pilot measures integration, not population efficacy.
Statistics stay at the earlier Monday snapshot; only published availability is
updated before kickoff. The archived historical market has no quote clock here.
"""
import json
import numpy as np
import pandas as pd
from common import INPUT,OUT,CACHE
from data import load,LAG
from build import CACHE as OLD_CACHE
from rich_build import RICH_CACHE
from graph_build import GRAPH_CACHE
from model import combine,load_model,predict
from availability import validate,at_cutoff,adjust_features
from evaluate import metrics

def main():
    events=validate(pd.read_csv(INPUT/'availability_events.csv'));rows=[];audit=[]
    for year in sorted(events.season.unique()):
        s=load(int(year));players=pd.read_csv(INPUT/f'players_{year}.csv')
        meta=pd.read_csv(OLD_CACHE/f'{year}.csv');r=np.load(RICH_CACHE/f'{year}.npz');g=np.load(GRAPH_CACHE/f'{year}.npz');extra=np.load(CACHE/f'{year}.npz')
        obj=load_model(OUT/'models'/f'full_{year}.json.gz')
        primary=meta[(meta['mode']=='weekly')&meta.fbs]
        for row in primary.itertuples():
            cutoff=pd.Timestamp(row.start_date).timestamp()-3600
            reports=pd.concat([at_cutoff(events,int(year),int(row.home),cutoff,int(row.game_id)),
                               at_cutoff(events,int(year),int(row.away),cutoff,int(row.game_id))])
            if reports.empty:continue
            tr=np.flatnonzero(s.games.time+LAG<=row.cutoff)
            # Reconstruct the complete current-season team snapshot, never obtain
            # an individual player's next-game participation as a feature.
            from graph_build import graph_features
            from rich_build import INPUT as ORIGINAL_INPUT
            from context_features import addon_features
            rich=pd.read_csv(ORIGINAL_INPUT/f'rich_{year}.csv');context=pd.read_csv(INPUT/f'context_{year}.csv')
            graph=graph_features(s,tr,rich);addon=addon_features(s,tr,context,players,row.cutoff)
            x=combine(graph[:,:64],graph,addon,'full')
            updated,details=adjust_features(x,'full',s,tr,players,events,cutoff,int(row.game_id))
            details=[d for d in details if d['team_id'] in [int(row.home),int(row.away)]]
            before=float(predict(obj,x[[row.h]],x[[row.a]],np.array([row.venue]))[0])
            after=float(predict(obj,updated[[row.h]],updated[[row.a]],np.array([row.venue]))[0])
            rows.append(dict(year=int(year),game_id=int(row.game_id),start_date=row.start_date,stats_cutoff=row.cutoff,
                report_cutoff=pd.Timestamp(cutoff,unit='s',tz='UTC').isoformat(),home=row.home_name,away=row.away_name,y=row.y,
                before_probability=before,after_probability=after,reports=len(reports),matched_reports=sum(d['matched'] for d in details)))
            audit.extend([dict(game_id=int(row.game_id),**d) for d in details])
    frame=pd.DataFrame(rows);frame.to_csv(OUT/'availability-pilot-predictions.csv',index=False,float_format='%.10f')
    pd.DataFrame(audit).to_csv(OUT/'availability-join-audit.csv',index=False)
    report=dict(games=len(frame),interpretation='Nonrepresentative hand-curated integration pilot. No claim of a general availability-model improvement.',
        actual_report_events=len(events),source_urls=events.source_url.nunique(),changed_forecasts=int((np.abs(frame.after_probability-frame.before_probability)>1e-10).sum()),
        baseline=metrics(frame.y,frame.before_probability),with_availability=metrics(frame.y,frame.after_probability),
        matched_report_rows=int(frame.matched_reports.sum()),unsupported_or_unmatched_rows=int(frame.reports.sum()-frame.matched_reports.sum()))
    (OUT/'availability-pilot.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Availability integration pilot',json.dumps(report,indent=2),flush=True)

if __name__=='__main__':main()
