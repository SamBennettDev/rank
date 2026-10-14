"""Construct sportsbook-only benchmarks, isolated from model inputs."""
import re,json
from pathlib import Path
import numpy as np
import pandas as pd
from prepare import HERE,INPUT,CACHE,REV,YEARS,digest,download

def norm(s):return re.sub('[^a-z0-9]','',str(s).lower())

def main():
    raw=CACHE/'odds.csv.gz'
    url=f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REV}/betting/csv/cfb_line_odds.csv.gz'
    download(url,raw)
    teamfile=CACHE/'teams_colors_logos.csv'
    tu=f'https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/{REV}/teams/teams_colors_logos.csv'
    download(tu,teamfile)
    teams=pd.read_csv(teamfile,encoding='latin1')
    aliases={}
    for r in teams.itertuples():
        aliases[int(r.team_id)]={norm(getattr(r,k)) for k in ['school','abbreviation','alt_name1','alt_name2','alt_name3'] if pd.notna(getattr(r,k))}
    q=pd.read_csv(raw)
    q=q[q.market_type.isin(['money_line','spread']) & q.home_team_id.notna() & q.away_team_id.notna()].copy()
    q['label']=q.abbr.map(norm)
    directhome=q.game_desc.str.split('@').str[1].map(norm)
    directaway=q.game_desc.str.split('@').str[0].map(norm)
    home=np.array([a in aliases.get(int(i),set()) for i,a in zip(q.home_team_id,q.label)]) | (q.label==directhome)
    away=np.array([a in aliases.get(int(i),set()) for i,a in zip(q.away_team_id,q.label)]) | (q.label==directaway)
    q['side']=np.where(home & ~away,1.,np.where(away & ~home,0.,np.nan))
    # One recognized label resolves its complement; never assume row order means home.
    labels=q.groupby(['game_id','book','market_type','label'],dropna=False).agg(
        side=('side','first'),odds=('odds','median'),line=('lines','median'),opening_line=('opening_lines','median')).reset_index()
    keys=['game_id','book','market_type']
    gb=labels.groupby(keys,dropna=False)
    size=gb.label.transform('size');known=gb.side.transform('count');sm=gb.side.transform('sum')
    fill=labels.side.isna() & (size==2) & (known==1)
    labels.loc[fill,'side']=1-sm[fill]
    unresolved=int(labels.side.isna().sum())
    labels=labels[labels.side.notna()]
    h=labels[labels.side==1].drop(columns=['side','label'])
    a=labels[labels.side==0].drop(columns=['side','label'])
    paired=h.merge(a,on=keys,suffixes=('_h','_a'),validate='one_to_one')
    ml=paired[(paired.market_type=='money_line') & (paired.odds_h.abs()>=100) & (paired.odds_a.abs()>=100)].copy()
    implied=lambda x:np.where(x<0,-x/(100-x),100/(100+x))
    ph=implied(ml.odds_h);pa=implied(ml.odds_a)
    ml['p']=ph/(ph+pa)
    mlc=ml.groupby('game_id').agg(moneyline_p=('p','median'),moneyline_books=('p','size'))
    sp=paired[(paired.market_type=='spread') & paired.line_h.notna() & paired.line_a.notna() & ((paired.line_h+paired.line_a).abs()<1e-6)].copy()
    sp['margin']=-sp.line_h
    spreads=sp.groupby('game_id').agg(spread_margin=('margin','median'),spread_books=('margin','size'))
    out=mlc.join(spreads,how='outer').reset_index();out.game_id=out.game_id.astype(int)
    source_home=q.groupby('game_id').home_team_id.first()
    canonical={};canonical_away={}
    for year in YEARS:
        schedule=pd.read_csv(INPUT/f'games_{year}.csv')
        canonical.update(dict(zip(schedule.game_id,schedule.home_id)))
        canonical_away.update(dict(zip(schedule.game_id,schedule.away_id)))
    out['quote_home_id']=out.game_id.map(source_home)
    out['canonical_home_id']=out.game_id.map(canonical)
    known=out.canonical_home_id.notna()
    if not ((out.quote_home_id[known]==out.canonical_home_id[known]) |
            (out.quote_home_id[known]==out.game_id[known].map(canonical_away))).all():
        raise ValueError('Archived quote teams do not match scheduled participants')
    reverse=out.canonical_home_id.notna()&out.quote_home_id.ne(out.canonical_home_id)
    out.loc[reverse,'moneyline_p']=1-out.loc[reverse,'moneyline_p']
    out.loc[reverse,'spread_margin']=-out.loc[reverse,'spread_margin']
    output=INPUT/'odds.csv';out.to_csv(output,index=False,float_format='%.8f')
    (HERE/'odds-sources.json').write_text(json.dumps(dict(url=url,sha256=digest(raw),
        team_labels_url=tu,team_labels_sha256=digest(teamfile),output_sha256=digest(output),games=len(out),
        moneyline_games=len(mlc),spread_games=len(spreads),unresolved_team_book_labels=unresolved,
        canonical_side_reversals=int(reverse.sum()),
        note='Game date_time is not a quote capture timestamp. Stored odds cannot be certified as closing or contemporaneous with the Monday model cutoff. No betting profitability claim.'),indent=2)+'\n')
    print('Odds:',len(out),'games;',len(mlc),'moneylines;',len(spreads),'spreads;',unresolved,'unresolved labels')

if __name__=='__main__':main()
