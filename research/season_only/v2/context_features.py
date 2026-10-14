"""Additional numeric current-season features, with no player or team embeddings."""
from dataclasses import replace
import numpy as np
import pandas as pd
from common import INPUT
from models import od, rating
from prepare_context import CONTEXT

CONTEXT_NAMES = [f'{name}_{side}' for name,_ in CONTEXT for side in ['offense','defense']]
EVIDENCE_NAMES = ['opponent_game_evidence','distinct_opponent_fraction','connected_schedule_fraction',
    'margin_standard_error','epa_standard_error','context_coverage','high_leverage_snap_evidence','days_since_last_game']
PLAYER_NAMES = ['qb_season_dominance','qb_leader_last_share','qb_changed_last_game','last_qb_epa',
    'backup_qb_epa','qb_absent_last_usage','qb_attempt_evidence','rb_season_dominance','rb_usage_concentration',
    'rb_absent_last_usage','receiver_season_dominance','receiver_usage_concentration','receiver_absent_last_usage',
    'recent_qb_continuity','recent_rush_continuity','recent_target_continuity']
SEQUENCE_METRICS = ['adjusted_margin','offensive_epa','defensive_epa','passing_down_epa','rushing_down_epa',
                    'turnover_rate','opponent_evidence','age_weeks']
SEQUENCE_NAMES = [f'game_lag_{lag}_{name}' for lag in [1,2,3] for name in SEQUENCE_METRICS]
ADDON_NAMES = CONTEXT_NAMES+EVIDENCE_NAMES+PLAYER_NAMES+SEQUENCE_NAMES

def _player_profile(games, players):
    out = np.zeros(16)
    if len(games)==0 or len(players)==0: return out
    latest = int(games.game_id.iloc[-1]); previous = int(games.game_id.iloc[-2]) if len(games)>1 else None
    for role, start, continuity in [('qb',0,13),('rb',7,14),('wr',10,15)]:
        p = players[players.role.eq(role)]
        if p.empty: continue
        total = p.groupby('player_key').agg(uses=('uses','sum'),epa=('epa','sum'))
        total = total.sort_values('uses',ascending=False,kind='stable')
        shares = total.uses / total.uses.sum()
        last = p[p.game_id.eq(latest)].groupby('player_key').uses.sum()
        last_share = last / max(last.sum(),1)
        missing = float(shares[~shares.index.isin(last_share.index)].sum())
        if role=='qb':
            out[0] = shares.iloc[0]
            top_keys = shares.index[np.isclose(shares,shares.iloc[0])]
            out[1] = last_share.reindex(top_keys,fill_value=0).mean()
            prior = p[p.game_id.eq(previous)].groupby('player_key').uses.sum() if previous is not None else pd.Series(dtype=float)
            if len(last)>0 and len(prior)>0:
                prior_share=prior/prior.sum();keys=last_share.index.union(prior_share.index)
                out[2]=1-np.minimum(last_share.reindex(keys,fill_value=0),prior_share.reindex(keys,fill_value=0)).sum()
            rates=total.epa/(total.uses+20)*60
            out[3] = float((rates.reindex(last_share.index)*last_share).sum())
            rest = total[~total.index.isin(last_share.index)]
            out[4] = rest.epa.sum()/(rest.uses.sum()+20)*60
            out[5] = missing
            out[6] = total.uses.sum()/(total.uses.sum()+100)
        else:
            out[start:start+3] = [shares.iloc[0],np.sum(shares**2),missing]
        older = p[p.game_id.isin(games.game_id.iloc[-3:-1])].groupby('player_key').uses.sum()
        if len(older):
            older /= older.sum()
            # Weighted retained production, measured only across already played games.
            out[continuity] = float(older[older.index.isin(last_share.index)].sum())
    return out

def addon_features(s, idx, context, players, cutoff):
    games = s.games.iloc[idx]
    used = set(games.game_id)
    ix = {int(t):i for i,t in enumerate(s.ids)}
    p = context[context.game_id.isin(used) & context.team_id.isin(ix) & context.opponent_id.isin(ix)].copy()
    p['t'] = p.team_id.map(ix).astype(int); p['u'] = p.opponent_id.map(ix).astype(int)
    gm = games.set_index('game_id')
    p['site'] = np.where(p.team_id==p.game_id.map(gm.home),1,-1)*p.game_id.map(gm.venue)
    columns = []
    for name,factor in CONTEXT:
        pp = p.copy();pp['snaps'] = pp[name+'_n'];pp['epa'] = pp[name+'_sum']
        ridge = 4. if name.startswith(('drive_','redzone_drive','scoring_opportunity')) else 60.
        offense,defense,_,_ = od(replace(s,plays=pp),idx,'epa',ridge)
        columns.extend([offense*factor,defense*factor])
    x = np.column_stack(columns)
    counts = np.bincount(games.h,minlength=s.n)+np.bincount(games.a,minlength=s.n)
    strength,hfa,_ = rating(s,idx)
    adjacency = np.zeros((s.n,s.n))
    np.add.at(adjacency,(games.h,games.a),1);np.add.at(adjacency,(games.a,games.h),1)
    # Component membership depends on the observed schedule, never a conference label.
    from scipy.sparse.csgraph import connected_components
    _, components = connected_components(adjacency,directed=False)
    component_size = np.bincount(components)[components]
    evidence = np.zeros((s.n,len(EVIDENCE_NAMES)))
    profile = np.zeros((s.n,len(PLAYER_NAMES)))
    sequence = np.zeros((s.n,len(SEQUENCE_NAMES)))
    actual_players = players[players.game_id.isin(used)]
    player_groups = {int(t):g for t,g in actual_players.groupby('team_id')}
    basic_plays = s.plays[s.plays.game_id.isin(used)].set_index(['game_id','team_id'])
    context_lookup = p.set_index(['game_id','team_id'])
    for i,t in enumerate(s.ids):
        own = games[(games.h==i)|(games.a==i)].sort_values(['time','game_id'])
        if own.empty: continue
        home = own.h.eq(i).to_numpy();opponents = np.where(home,own.a,own.h)
        margin = np.where(home,own.margin,-own.margin)
        rows = p[p.t.eq(i)]
        own_plays = s.plays[s.plays.game_id.isin(own.game_id)&s.plays.team_id.eq(t)]
        epa = own_plays.epa.to_numpy()/np.maximum(own_plays.snaps,1)
        present = sum(rows[name+'_n'].sum()>0 for name,_ in CONTEXT)/len(CONTEXT)
        high = rows.third_long_conversion_n.sum()+rows.redzone_success_n.sum()
        evidence[i] = [np.mean(counts[opponents]/(counts[opponents]+4)),len(set(opponents))/(len(own)+1),
            (component_size[i]-1)/max(s.n-1,1),np.std(margin)/np.sqrt(len(margin)+1)/20,
            (np.std(epa)/np.sqrt(len(epa)+1) if len(epa) else 0),present,high/(high+100),
            min((cutoff-own.time.iloc[-1])/86400,60)/14]
        own_players = player_groups.get(int(t),actual_players.iloc[:0])
        profile[i] = _player_profile(own,own_players)
        for lag,row in enumerate(own.iloc[::-1].head(3).itertuples()):
            is_home = row.h==i;other = row.a if is_home else row.h;other_id = s.ids[other]
            key = (row.game_id,int(t));other_key=(row.game_id,int(other_id))
            q = basic_plays.loc[key] if key in basic_plays.index else None
            d = basic_plays.loc[other_key] if other_key in basic_plays.index else None
            c = context_lookup.loc[key] if key in context_lookup.index else None
            def rate(frame,value,n): return float(frame[value]/max(frame[n],1)) if frame is not None else 0.
            observed = row.margin if is_home else -row.margin
            site = row.venue if is_home else -row.venue
            sequence[i,lag*8:(lag+1)*8] = [np.clip(observed-site*hfa+strength[other],-60,60),
                rate(q,'epa','snaps')*60,-rate(d,'epa','snaps')*60,
                rate(c,'pass_down_epa_sum','pass_down_epa_n')*60,
                rate(c,'rush_down_epa_sum','rush_down_epa_n')*60,
                rate(c,'drive_turnover_sum','drive_turnover_n')*10,
                counts[other]/(counts[other]+4),min((cutoff-row.time)/(7*86400),10)]
    out = np.c_[x,evidence,profile,sequence]
    assert out.shape==(s.n,len(ADDON_NAMES)) and np.isfinite(out).all()
    return out
