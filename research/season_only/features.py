"""Feature whitelist. All team values are refit from this season before the cutoff."""
import numpy as np
from models import method,rating,od,special

NAMES=['margin_rating','capped_margin_rating','robust_margin_rating','win_rating','colley','bradley_terry',
       'elo','score_offense','score_defense','epa_offense','epa_defense','success_offense','success_defense',
       'special_teams','average_margin','points_for','points_against','win_fraction','schedule_strength',
       'recent_margin_rating','game_evidence','snap_evidence','pbp_coverage','margin_variation',
       'raw_offensive_success','raw_defensive_success','raw_offensive_epa','raw_defensive_epa']

def features(s,idx,cache):
    g=s.games.iloc[idx];h=g.h.to_numpy();a=g.a.to_numpy();m=g.margin.to_numpy(float);n=s.n
    counts=np.bincount(h,minlength=n)+np.bincount(a,minlength=n)
    avg=lambda x:np.asarray(x)/np.maximum(counts,1)
    base=method('massey',ridge=1.).fit(s,idx,cache)
    cap=method('capped_margin',ridge=1.,cap=35.).fit(s,idx,cache)
    robust=method('robust_margin',ridge=1.,huber=14.).fit(s,idx,cache)
    win=method('win_springs',ridge=1.,win_only=True).fit(s,idx,cache)
    col=method('colley').fit(s,idx,cache)
    bt=method('bradley_terry',ridge=1.).fit(s,idx,cache)
    elo=method('elo',k=40,mov=True).fit(s,idx,cache)
    o,d,_,_=od(s,idx,'score')
    eo,ed,snaps,_=od(s,idx,'epa')
    so,sd,_,_=od(s,idx,'success')
    st=special(s,idx)
    rec=method('recency_margin',ridge=1.,half=28.,cap=35.).fit(s,idx,cache)
    pf=np.bincount(h,g.home_points,n)+np.bincount(a,g.away_points,n)
    pa=np.bincount(h,g.away_points,n)+np.bincount(a,g.home_points,n)
    wins=np.bincount(np.where(m>0,h,a),minlength=n)
    opp=np.bincount(h,base[a],n)+np.bincount(a,base[h],n)
    m2=np.bincount(h,m*m,n)+np.bincount(a,m*m,n)
    p=s.plays[s.plays.game_id.isin(g.game_id)]
    ts=np.bincount(p.t,p.snaps,n);us=np.bincount(p.u,p.snaps,n)
    pbpg=np.bincount(p.t,minlength=n)
    raw=lambda col,side,cnt:np.bincount(p[side],p[col],n)/np.maximum(cnt,1)
    rawsuccoff=raw('success','t',ts)-.4*(ts>0)
    rawsuccdef=.4*(us>0)-raw('success','u',us)
    x=np.column_stack([base,cap,robust,win,col,bt,elo,o,d,60*eo,60*ed,100*so,100*sd,st,
        avg(pf-pa),avg(pf),-avg(pa),wins/np.maximum(counts,1)-.5*(counts>0),avg(opp),rec,
        counts/(counts+4),snaps/(snaps+400),pbpg/np.maximum(counts,1),
        np.sqrt(np.maximum(0,avg(m2)-avg(pf-pa)**2)),rawsuccoff,rawsuccdef,
        raw('epa','t',ts),-raw('epa','u',us)])
    # An unplayed team has exactly the same input regardless of metadata.
    x[counts==0]=0
    assert x.shape==(n,len(NAMES)) and np.isfinite(x).all()
    return x
