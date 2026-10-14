"""Build a sourced, explicitly nonrepresentative historical availability pilot.

Publication-day upper bounds are conservative availability times, not invented
precise capture timestamps. These announcements cannot support full-season
coverage or an unbiased estimate of the injury feature's value.
"""
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from common import INPUT,OUT
from data import load
from availability import REQUIRED,validate
from prepare import digest,download
from prepare_context import normalize_name

def main():
    rows=[]
    def add(year,team,player,position,status,date,url,opponent=None,scope='game',precision='publication_day_upper_bound'):
        published=(pd.Timestamp(date).tz_localize(ZoneInfo('America/New_York'))+pd.Timedelta(days=1)).tz_convert('UTC')
        game=np.nan
        if opponent:
            s=load(year);g=s.games[((s.games.home==team)|(s.games.away==team))&
                ((s.games.home_team==opponent)|(s.games.away_team==opponent))&s.games.time.gt(published.timestamp())]
            if len(g)!=1:raise ValueError(f'Ambiguous pilot game {year} {team} {opponent}')
            game=int(g.game_id.iloc[0]);until=pd.Timestamp(g.time.iloc[0]+6*3600,unit='s',tz='UTC')
        else:until=pd.Timestamp(f'{year+1}-03-01T00:00:00Z')
        rows.append(dict(season=year,team_id=team,athlete_id=np.nan,player_name=player,position=position,status=status,
            published_at=published.isoformat(),available_at=published.isoformat(),effective_from=published.isoformat(),valid_until=until.isoformat(),
            game_id=game,source_url=url,time_precision=precision,scope=scope))
    add(2022,152,'Devin Leary','QB','out','2022-10-15',
        'https://www.clickorlando.com/sports/2022/10/15/nc-state-qb-devin-leary-out-for-season-will-have-surgery/',scope='season')
    add(2023,52,'Jordan Travis','QB','out','2023-11-20',
        'https://news.wfsu.org/wfsu-local-news/2023-11-20/college-football-playoffs-can-florida-state-keep-playoff-hopes-alive-after-travis-injury',scope='season')
    add(2023,30,'Caleb Williams','QB','opt_out','2023-12-04',
        'https://www.cbsnews.com/losangeles/news/heisman-winner-caleb-williams-to-skip-uscs-holiday-bowl-trip-fueling-nfl-expectations-2/',opponent='Louisville')
    add(2024,57,'Graham Mertz','QB','out','2024-10-14',
        'https://floridagators.com/news/2024/10/14/football-gators-freshman-qb-Lagways-time-has-arrived-with-veteran-mertzs-season-over-florida-sec-kentucky',scope='season')
    add(2024,254,'Cameron Rising','QB','out','2024-10-14',
        'https://kutv.com/sports/utah-utes/utah-qb-cam-rising-out-indefinitely-freshman-isaac-wilson-named-starter',opponent='TCU')
    add(2024,152,'Grayson McCall','QB','out','2024-10-24',
        'https://www.reuters.com/sports/nc-state-qb-grayson-mccall-concussions-retires-football-2024-10-24/',scope='season')
    add(2024,150,'Maalik Murphy','QB','opt_out','2024-12-10',
        'https://www.wral.com/sports/archive/21749965/',opponent='Ole Miss')
    add(2025,201,'John Mateer','QB','out','2025-09-23',
        'https://soonersports.com/news/2025/9/23/football-mateer-to-undergo-surgery-wednesday',opponent='Kent State')
    add(2024,57,'Eugene Wilson III','WR','out','2024-11-06',
        'https://floridagators.com/news/2024/11/6/football-carters-corner-hbc-meets-mcconaughey-wilson-webb-takes-on-napier',scope='season')
    preview='https://floridagators.com/news/2024/11/15/football-the-opening-kickoff-no-21-lsu-at-florida-lagway-back-at-qb-florida-vs-lsu-sec-football'
    for player,position in [('Jamari Lyons','DL'),('Kahleil Jackson','WR'),('Graham Mertz','QB'),('Eugene Wilson III','WR'),
        ('Jason Marshall Jr.','CB'),('Devin Moore','CB'),('Asa Turner','S'),("Ja'Keem Jackson",'CB'),
        ('Devon Manuel','OL'),('Treyaun Webb','RB'),('Grayson Howard','LB')]:
        add(2024,57,player,position,'out','2024-11-15',preview,opponent='LSU')
    d=pd.DataFrame(rows)
    # Roster metadata resolves IDs only. No recruiting, year, age, or historical
    # performance fields are read or passed into a model.
    def roster(year):
        import pyarrow.parquet as pq
        url=f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/8c248d2acdf625327b5167df4b0a52cbb03a74ce/cfb/cfb_rosters/parquet/cfb_rosters_{year}.parquet'
        raw=Path(f'/tmp/rank-season-only/rosters_{year}.parquet');download(url,raw)
        q=pq.read_table(raw,columns=['team_id','athlete_id','full_name']).to_pandas();q['name_key']=q.full_name.map(normalize_name)
        return year,q,dict(url=url,sha256=digest(raw))
    roster_sources={};joins=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for year,q,source in pool.map(roster,sorted(d.season.unique())):
            roster_sources[str(year)]=source
            for i,row in d[d.season.eq(year)].iterrows():
                match=q[q.team_id.eq(row.team_id)&q.name_key.eq(normalize_name(row.player_name))].athlete_id.unique()
                if len(match)==1:
                    d.loc[i,'athlete_id']=int(match[0]);joins.append(dict(season=int(year),team_id=int(row.team_id),player_name=row.player_name,athlete_id=int(match[0])))
    pd.DataFrame(joins).drop_duplicates().to_csv(INPUT/'availability_player_joins.csv',index=False)
    validate(d);path=INPUT/'availability_events.csv';d[REQUIRED].to_csv(path,index=False)
    (OUT/'availability-pilot-sources.json').write_text(json.dumps(dict(rows=len(d),sources=sorted(d.source_url.unique()),output_sha256=digest(path),
        timestamp_rule='Day-only announcements become available after the end of the publication day in America/New_York. They are never assigned a fabricated intra-day time.',
        roster_sources=roster_sources,roster_identity_joins=len(joins),
        scope='Small curated pilot selected for integration checks, not a representative injury dataset; report coverage is unknown outside these rows.'),indent=2)+'\n')
    print('Availability pilot:',len(d),'events from',d.source_url.nunique(),'sources',flush=True)

if __name__=='__main__':main()
