"""Download auditable inputs; never use poll, talent, Elo or line data as model features."""
from pathlib import Path
import csv, hashlib, json, urllib.request, shutil
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
INPUT = HERE / 'inputs'
CACHE = Path('/tmp/rank-season-only')
REV = 'a3dd960090c1bfa169cebd491beabf7028b379b2'
YEARS = list(range(2002, 2026))

def digest(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def download(url, path):
    if not path.exists():
        tmp = path.with_suffix(path.suffix + '.part')
        with urllib.request.urlopen(url, timeout=120) as response, open(tmp, 'wb') as out:
            shutil.copyfileobj(response, out)
        tmp.replace(path)

def prepare_year(year):
    INPUT.mkdir(exist_ok=True); CACHE.mkdir(exist_ok=True)
    su = f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REV}/schedules/csv/cfb_schedules_{year}.csv'
    pu = (f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REV}/pbp/parquet/play_by_play_{year}.parquet'
          if year < 2014 or year == 2020 else
          f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfbfastR_cfb_pbp/play_by_play_{year}.parquet')
    schedule, pbp, agg = INPUT / f'games_{year}.csv', CACHE / f'pbp_{year}.parquet', INPUT / f'plays_{year}.csv'
    download(su, schedule)
    old_path = HERE / 'sources.json'
    old = json.loads(old_path.read_text()) if old_path.exists() else {}
    old_entry = old.get(str(year), {})
    if agg.exists() and old_entry.get('aggregation_version') == 2 and digest(agg) == old_entry.get('plays_sha256'):
        return str(year), old_entry
    download(pu, pbp)
    raw_hash = digest(pbp)
    if old_entry.get('raw_pbp_sha256') and raw_hash != old_entry['raw_pbp_sha256']:
        raise ValueError(f'{year}: upstream PBP changed; refusing silent source drift')
    available = pq.ParquetFile(pbp).schema_arrow.names
    aliases = {'game_id':['game_id'], 'pos_team':['pos_team','posteam','start_posteam_name'],
        'home_team':['home_team','home_team_name','homeTeamName'], 'away_team':['away_team','away_team_name','awayTeamName'],
        'home_team_id':['home_team_id','homeTeamId'], 'away_team_id':['away_team_id','awayTeamId'],
        'rush':['rush'], 'pass':['pass'], 'EPA':['EPA','epa'], 'success':['success','EPA_success','epa_success'],
        'pos_unit':['pos_unit'], 'kickoff_play':['kickoff_play'], 'punt':['punt'],
        'fg_inds':['fg_inds','field_goal_attempt','fg_attempt'], 'period':['period'],
        'pos_score_diff_start':['pos_score_diff_start','start_posteam_score_differential','start.posteam_score_differential'],
        'spread':['spread','home_team_spread','homeTeamSpread'],
        'possessor_id':['start_posteam_id','start.posteam.id','start.pos_team.id']}
    read_cols = list(dict.fromkeys(c for options in aliases.values() for c in options if c in available))
    original = pq.read_table(pbp, columns=read_cols).to_pandas()
    frame = pd.DataFrame(index=original.index)
    for name,options in aliases.items():
        present=[c for c in options if c in original]
        if present:
            frame[name]=original[present[0]]
            for c in present[1:]: frame[name]=frame[name].combine_first(original[c])
    if 'possessor_id' in frame:
        owner=pd.to_numeric(frame.possessor_id,errors='coerce')
        frame['pos_team'] = np.where(owner==pd.to_numeric(frame.home_team_id),frame.home_team,
                           np.where(owner==pd.to_numeric(frame.away_team_id),frame.away_team,frame.pos_team))
    frame = frame[frame.EPA.notna() & ((frame.pos_team == frame.home_team) | (frame.pos_team == frame.away_team))].copy()
    home = frame.pos_team == frame.home_team
    frame['team_id'] = np.where(home, frame.home_team_id, frame.away_team_id).astype(int)
    frame['opponent_id'] = np.where(home, frame.away_team_id, frame.home_team_id).astype(int)
    scrim = ((frame['rush'] == 1) | (frame['pass'] == 1)) & (frame.pos_unit.fillna('Offense') == 'Offense')
    gap = frame.pos_score_diff_start.abs()
    garbage = ((frame.period == 2) & (gap > 38)) | ((frame.period == 3) & (gap > 28)) | ((frame.period >= 4) & (gap > 22))
    frame['success'] = frame.success.fillna(0)
    keys = ['game_id', 'team_id', 'opponent_id']
    a = frame[scrim & ~garbage].groupby(keys).agg(snaps=('EPA', 'size'), epa=('EPA', 'sum'), success=('success', 'sum'))
    full = frame[scrim].groupby(keys).agg(all_snaps=('EPA','size'), all_epa=('EPA','sum'), all_success=('success','sum'))
    special = ~scrim & ((frame.kickoff_play == 1) | (frame.punt == 1) | (frame.fg_inds == 1) | frame.pos_unit.isin(['Kickoff Return', 'Punt Offense', 'Field Goal Offense']))
    st = frame[special].groupby(keys).EPA.sum().rename('special_epa').reset_index()
    mirror = st.rename(columns={'team_id':'opponent_id', 'opponent_id':'team_id'}).copy()
    mirror['special_epa'] *= -1
    st = pd.concat([st, mirror]).groupby(keys).special_epa.sum()
    out = full.join(a, how='outer').join(st, how='outer').fillna(0).reset_index()
    spread = frame.groupby('game_id')['spread'].first() if 'spread' in frame else pd.Series(dtype=float, name='spread')
    out = out.join(spread.rename('spread'), on='game_id')
    out.to_csv(agg, index=False, float_format='%.6f')
    entry = dict(aggregation_version=2,schedule_url=su, schedule_sha256=digest(schedule), raw_pbp_url=pu,
                 raw_pbp_sha256=raw_hash, plays_sha256=digest(agg), team_game_rows=len(out))
    print(f'Prepared {year}: {len(out)} team-game rows', flush=True)
    return str(year), entry

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        sources = dict(pool.map(prepare_year, YEARS))
    for name in ['teams.csv', 'games.csv', 'plays.csv']:
        sources['2026_' + name] = dict(path='data/seasons/2026/' + name, sha256=digest(ROOT / 'data/seasons/2026' / name))
    (HERE / 'sources.json').write_text(json.dumps(sources, indent=2) + '\n')
