"""Additional current-season passing, rushing, drive and disruption statistics."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from prepare import INPUT,CACHE,HERE,YEARS,digest,download

METRICS=['pass_epa','rush_epa','pass_success','rush_success','pass_yards','rush_yards','explosive',
         'turnover','sack','third_success','nonto_epa','drive_epa','completion','field_position']
SCALES=[60,60,100,100,4,4,100,100,100,100,60,10,100,1]
ALIASES={'gid':['game_id'],'home':['home_team_id','homeTeamId'],'away':['away_team_id','awayTeamId'],
    'team':['start.pos_team.id','start_posteam_id','start.posteam.id','pos_team'],
    'team_name':['pos_team','posteam'],'home_name':['home_team','home_team_name','homeTeamName'],
    'away_name':['away_team','away_team_name','awayTeamName'],'rush':['rush'],'pass':['pass'],
    'epa':['EPA','epa'],'success':['success','EPA_success','epa_success'],'unit':['pos_unit'],
    'period':['period'],'gap':['pos_score_diff_start','start_posteam_score_differential','start.posteam_score_differential'],
    'yards':['yards_gained','stat_yardage','statYardage'],'turnover':['turnover','turnover_vec'],
    'sack':['sack','sack_vec'],'completion':['completion','complete_pass'],
    'down':['down','start_down','start.down'],'distance':['distance','ydstogo','start_distance','start.distance'],
    'drive':['drive_id','drive.id','id_drive'],'start_yards':['drive_start_yards_to_goal','start_yards_to_endzone','start.yardsToEndzone','yards_to_goal']}

def prepare(year):
    raw=CACHE/f'pbp_{year}.parquet';output=INPUT/f'rich_{year}.csv'
    if year==2026:
        download('https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfbfastR_cfb_pbp/play_by_play_2026.parquet',raw)
    available=pq.ParquetFile(raw).schema_arrow.names
    columns=list(dict.fromkeys(c for opts in ALIASES.values() for c in opts if c in available))
    src=pq.read_table(raw,columns=columns).to_pandas();d=pd.DataFrame(index=src.index)
    for name,opts in ALIASES.items():
        cols=[c for c in opts if c in src]
        if cols:
            d[name]=src[cols[0]]
            for c in cols[1:]:d[name]=d[name].combine_first(src[c])
        else:d[name]=np.nan
    owner=pd.to_numeric(d.team,errors='coerce')
    d['team_id']=np.where(owner==pd.to_numeric(d.home),d.home,
                        np.where(owner==pd.to_numeric(d.away),d.away,
                        np.where(d.team_name==d.home_name,d.home,np.where(d.team_name==d.away_name,d.away,np.nan))))
    d['opponent_id']=np.where(d.team_id==d.home,d.away,d.home)
    scrim=((d['rush']==1)|(d['pass']==1))&d.unit.fillna('Offense').eq('Offense')
    garbage=((d.period==2)&(d.gap.abs()>38))|((d.period==3)&(d.gap.abs()>28))|((d.period>=4)&(d.gap.abs()>22))
    d=d[scrim&~garbage&d.epa.notna()&d.team_id.notna()].copy()
    for c in ['team_id','opponent_id','gid']:d[c]=d[c].astype(int)
    d['pass_flag']=d['pass']==1;d['rush_flag']=d['rush']==1
    d['explosive']=((d.pass_flag&(d.yards>=20))|(d.rush_flag&(d.yards>=10))).astype(float)
    d['negative_turnover']=-d.turnover.fillna(0).clip(0,1);d['negative_sack']=-d.sack.fillna(0).clip(0,1)
    d['third_success']=np.where(d.yards.notna()&d.distance.notna(),d.yards>=d.distance,d.success.fillna(0)).astype(float)
    groups=d.groupby(['gid','team_id','opponent_id'],sort=True)
    base=groups.size().rename('scrimmage_snaps').to_frame()
    definitions={
      'pass_epa':('pass_flag','epa'),'rush_epa':('rush_flag','epa'),
      'pass_success':('pass_flag','success'),'rush_success':('rush_flag','success'),
      'pass_yards':('pass_flag','yards'),'rush_yards':('rush_flag','yards'),
      'explosive':(None,'explosive'),'turnover':(None,'negative_turnover'),'sack':('pass_flag','negative_sack'),
      'third_success':('third','third_success'),'nonto_epa':('no_turnover','epa'),'completion':('pass_flag','completion')}
    d['third']=d.down.eq(3);d['no_turnover']=d.turnover.fillna(0).eq(0)
    for metric,(mask,value) in definitions.items():
        part=d if mask is None else d[d[mask]]
        part=part[part[value].notna()]
        agg=part.groupby(['gid','team_id','opponent_id'])[value].agg(['sum','count'])
        base=base.join(agg.rename(columns={'sum':metric+'_sum','count':metric+'_n'}))
    # EPA per distinct offensive drive; no drive-result labels or future game summaries.
    bydrive=d[d.drive.notna()].groupby(['gid','team_id','opponent_id','drive'],sort=False).agg(epa=('epa','sum'),start=('start_yards','first'))
    drive=bydrive.groupby(level=[0,1,2]).epa.agg(['sum','count'])
    base=base.join(drive.rename(columns={'sum':'drive_epa_sum','count':'drive_epa_n'}))
    position=(100-bydrive.start.clip(0,100)).groupby(level=[0,1,2]).agg(['sum','count'])
    base=base.join(position.rename(columns={'sum':'field_position_sum','count':'field_position_n'}))
    base.fillna(0).reset_index().rename(columns={'gid':'game_id'}).to_csv(output,index=False,float_format='%.6f')
    print('Rich statistics',year,len(base),'rows',flush=True)
    return str(year),dict(raw_sha256=digest(raw),rich_sha256=digest(output),team_game_rows=len(base))

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:manifest=dict(pool.map(prepare,YEARS+[2026]))
    (HERE/'rich-sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
