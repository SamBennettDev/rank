"""Compact causal source statistics: situation, complete drives, and player usage.

Rows contain one completed game only. Snapshot construction applies game dates.
Player keys and names are joins, never neural inputs. Source hashes are recorded.
"""
import json
import re
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from common import INPUT, OUT, YEARS
from prepare import CACHE as RAW, digest
from rich_prepare import ALIASES

CONTEXT = [
    ('early_pass_epa', 60.), ('early_rush_epa', 60.),
    ('third_long_conversion', 100.), ('short_conversion', 100.),
    ('long_distance_epa', 60.), ('redzone_success', 100.),
    ('backed_up_epa', 60.), ('neutral_state_epa', 60.),
    ('late_close_epa', 60.), ('redzone_drive_points', 1.),
    ('scoring_opportunity_points', 1.), ('drive_points', 1.),
    ('drive_net_yards', .2), ('drive_positive_epa', 10.),
    ('drive_turnover', -10.), ('drive_seconds_per_snap', -.2),
    ('pass_down_epa', 60.), ('rush_down_epa', 60.),
    ('first_down_success', 100.), ('fourth_conversion', 100.),
]

def normalize_name(value):
    value = re.sub(r'\b(jr|sr|ii|iii|iv)\b', '', str(value).lower())
    return re.sub('[^a-z0-9]', '', value)

def prepare(year):
    raw = RAW / f'pbp_{year}.parquet'
    aliases = dict(ALIASES)
    aliases.update({
        'goal': ['yards_to_goal', 'start_yards_to_endzone', 'start.yardsToEndzone'],
        'drive_points': ['drive_pts', 'new_drive_pts'],
        'remaining': ['TimeSecsRem', 'start.adj_TimeSecsRem'],
        'qb': ['passer_player_name'], 'rb': ['rusher_player_name'], 'wr': ['receiver_player_name'],
        'qb_completed': ['completion_player_id'], 'qb_incomplete': ['incompletion_player_id'],
        'qb_intercepted': ['interception_thrown_player_id'], 'qb_sacked': ['sack_taken_player_id'], 'rb_id': ['rush_player_id'],
        'wr_id': ['reception_player_id', 'target_player_id'],
    })
    available = pq.read_schema(raw).names
    columns = list(dict.fromkeys(c for options in aliases.values() for c in options if c in available))
    src = pq.read_table(raw, columns=columns).to_pandas()
    d = pd.DataFrame(index=src.index)
    for name, options in aliases.items():
        present = [c for c in options if c in src]
        d[name] = src[present[0]] if present else np.nan
        for c in present[1:]: d[name] = d[name].combine_first(src[c])
    owner = pd.to_numeric(d.team, errors='coerce')
    home = pd.to_numeric(d.home, errors='coerce'); away = pd.to_numeric(d.away, errors='coerce')
    d['team_id'] = np.where(owner.eq(home), home, np.where(owner.eq(away), away,
        np.where(d.team_name.eq(d.home_name), home, np.where(d.team_name.eq(d.away_name), away, np.nan))))
    d['opponent_id'] = np.where(d.team_id.eq(home), away, home)
    scrim = (d['rush'].eq(1) | d['pass'].eq(1)) & d.unit.fillna('Offense').eq('Offense')
    garbage = (d.period.eq(2) & d.gap.abs().gt(38)) | (d.period.eq(3) & d.gap.abs().gt(28)) | (d.period.ge(4) & d.gap.abs().gt(22))
    d = d[scrim & ~garbage & d.epa.notna() & d.team_id.notna()].copy()
    for col in ['gid', 'team_id', 'opponent_id']: d[col] = d[col].astype(int)
    d['conversion'] = np.where(d.yards.notna() & d.distance.notna(), d.yards.ge(d.distance), d.success).astype(float)
    keys = ['gid', 'team_id', 'opponent_id']
    base = d.groupby(keys).size().rename('context_snaps').to_frame()
    definitions = {
        'early_pass_epa': (d.down.le(2) & d['pass'].eq(1), 'epa'),
        'early_rush_epa': (d.down.le(2) & d['rush'].eq(1), 'epa'),
        'third_long_conversion': (d.down.eq(3) & d.distance.ge(7), 'conversion'),
        'short_conversion': (d.distance.le(3), 'conversion'),
        'long_distance_epa': (d.distance.ge(8), 'epa'),
        'redzone_success': (d.goal.le(20), 'success'),
        'backed_up_epa': (d.goal.ge(80), 'epa'),
        'neutral_state_epa': (d.gap.abs().le(8) & d.period.le(3), 'epa'),
        'late_close_epa': (d.gap.abs().le(8) & d.period.eq(4), 'epa'),
        'pass_down_epa': ((d.down.eq(2) & d.distance.ge(8) | d.down.ge(3) & d.distance.ge(5)) & d['pass'].eq(1), 'epa'),
        'rush_down_epa': ((d.down.eq(1) | d.down.eq(2) & d.distance.le(6)) & d['rush'].eq(1), 'epa'),
        'first_down_success': (d.down.eq(1), 'success'),
        'fourth_conversion': (d.down.eq(4), 'conversion'),
    }
    for name, (mask, value) in definitions.items():
        a = d[mask & d[value].notna()].groupby(keys)[value].agg(['sum', 'count'])
        base = base.join(a.rename(columns={'sum': name+'_sum', 'count': name+'_n'}))
    drives = d[d.drive.notna()].groupby(keys+['drive'], sort=False).agg(
        points=('drive_points', 'first'), closest=('goal', 'min'), yards=('yards', 'sum'),
        epa=('epa', 'sum'), turnover=('turnover', 'max'),
        max_time=('remaining', 'max'), min_time=('remaining', 'min'), snaps=('epa', 'size'),
        first_period=('period', 'first'), last_period=('period', 'last'))
    # Crossing a half resets half clocks in some source eras; exclude those pace rows.
    drives['pace'] = ((drives.max_time-drives.min_time)/drives.snaps).clip(0,60)
    drives.loc[(drives.first_period.le(2) & drives.last_period.gt(2)), 'pace'] = np.nan
    drives['positive'] = drives.epa.gt(0).astype(float)
    drive_defs = {
        'redzone_drive_points': (drives.closest.le(20), 'points'),
        'scoring_opportunity_points': (drives.closest.le(40), 'points'),
        'drive_points': (np.ones(len(drives),bool), 'points'),
        'drive_net_yards': (np.ones(len(drives),bool), 'yards'),
        'drive_positive_epa': (np.ones(len(drives),bool), 'positive'),
        'drive_turnover': (np.ones(len(drives),bool), 'turnover'),
        'drive_seconds_per_snap': (np.ones(len(drives),bool), 'pace'),
    }
    for name, (mask, value) in drive_defs.items():
        a = drives[mask & drives[value].notna()].groupby(level=[0,1,2])[value].agg(['sum','count'])
        base = base.join(a.rename(columns={'sum': name+'_sum', 'count': name+'_n'}))
    out = base.fillna(0).reset_index().rename(columns={'gid':'game_id'})
    path = INPUT / f'context_{year}.csv'; out.to_csv(path,index=False,float_format='%.6f')
    # Passing IDs only appear on specific result types; names are the stable fallback.
    d['qb_id'] = d.qb_completed.combine_first(d.qb_incomplete).combine_first(d.qb_intercepted).combine_first(d.qb_sacked)
    player_rows = []
    for role, flag in [('qb','pass'),('rb','rush'),('wr','pass')]:
        part = d[d[flag].eq(1) & d[role].notna()].copy()
        part['name'] = part[role].astype(str)
        part['name'] = part.name.str.replace(r'^(?:No Huddle[- ]?)?(?:Shotgun|Huddle)\s*','',regex=True).str.replace(r'^#\d+\s*','',regex=True).str.strip()
        part=part[~part.name.str.lower().isin(['team','incomplete','unknown','none','nan'])]
        part['normalized_name'] = part.name.map(normalize_name)
        part['athlete_id'] = pd.to_numeric(part[role+'_id'],errors='coerce')
        # One athlete can have multiple PBP text spellings. IDs unify those records;
        # unambiguous name-to-ID links recover plays without a result-type ID.
        links=part[part.athlete_id.notna()].groupby(['team_id','normalized_name']).athlete_id.agg(['first','nunique'])
        lookup=links[links['nunique'].eq(1)]['first'].to_dict()
        recovered=pd.Series([lookup.get((t,n),np.nan) for t,n in zip(part.team_id,part.normalized_name)],index=part.index)
        part['athlete_id']=part.athlete_id.fillna(recovered)
        part['player_key']=[f'id:{int(i)}' if pd.notna(i) else f'name:{n}' for i,n in zip(part.athlete_id,part.normalized_name)]
        agg = part.groupby(keys+['player_key'],sort=True).agg(
            name=('name','first'),athlete_id=('athlete_id','first'),
            uses=('epa','size'),epa=('epa','sum'),yards=('yards','sum'))
        agg['role'] = role; player_rows.append(agg.reset_index())
    players = pd.concat(player_rows,ignore_index=True).rename(columns={'gid':'game_id'})
    pp = INPUT / f'players_{year}.csv'; players.to_csv(pp,index=False,float_format='%.6f')
    print('Context and player aggregates',year,len(out),len(players),flush=True)
    return str(year),dict(raw_sha256=digest(raw),context_sha256=digest(path),players_sha256=digest(pp),
                          context_rows=len(out),player_rows=len(players))

if __name__ == '__main__':
    with ProcessPoolExecutor(max_workers=3) as pool:
        manifest = dict(pool.map(prepare, YEARS))
    (OUT/'context-sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
