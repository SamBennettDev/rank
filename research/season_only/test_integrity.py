"""Research integrity tests: causal snapshots, identity symmetry, sources and reports."""
import copy,json,unittest
from pathlib import Path
import numpy as np
import pandas as pd
from data import load,batches,week6,LAG
from features import features,NAMES
from models import candidates,method
from neural import Network
from rolling import predict
from evaluate import metrics
from prepare import HERE,INPUT,ROOT,digest
from build import OUT,CACHE

class Integrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=load(2026);_,cls.tr,_=week6(cls.s)
        cls.x=features(cls.s,cls.tr,{})
        cls.model=json.loads((OUT/'rolling-models/2026.json').read_text())

    def test_feature_whitelist(self):
        self.assertEqual(len(NAMES),28)
        forbidden={'name','id','conference','division','preseason','odds','talent'}
        self.assertFalse(any(forbidden.intersection(f.split('_')) for f in NAMES))

    def test_rename_identity(self):
        renamed=copy.deepcopy(self.s);renamed.names=['anonymous']*renamed.n
        renamed.ids=np.arange(100000,100000+renamed.n)
        for c in ['home_team','away_team']:renamed.games[c]='anonymous'
        np.testing.assert_array_equal(features(renamed,self.tr,{}),self.x)

    def test_reindex_teams(self):
        s=copy.deepcopy(self.s);rng=np.random.default_rng(4);perm=rng.permutation(s.n);inverse=np.argsort(perm)
        s.ids=s.ids[perm];s.names=[s.names[i] for i in perm];s.fbs=s.fbs[perm]
        for c in ['h','a']:s.games[c]=inverse[s.games[c].to_numpy()]
        for c in ['t','u']:s.plays[c]=inverse[s.plays[c].to_numpy()]
        np.testing.assert_allclose(features(s,self.tr,{}),self.x[perm],atol=1e-8,rtol=1e-8)

    def test_future_scores_and_plays_cannot_change_snapshot(self):
        s=load(2025);cut,tr,te=next(batches(s));before=features(s,tr,{})
        changed=copy.deepcopy(s);future=np.setdiff1d(np.arange(len(s.games)),tr)
        changed.games.loc[future,['margin','home_points','away_points']]=999
        played=set(s.games.iloc[tr].game_id);mask=~changed.plays.game_id.isin(played)
        changed.plays.loc[mask,['epa','success','snaps','special_epa']]=999
        np.testing.assert_array_equal(before,features(changed,tr,{}))

    def test_chronology_every_season(self):
        for year in range(2002,2026):
            s=load(year)
            for cut,tr,te in batches(s):
                self.assertTrue(np.all(s.games.time.iloc[tr]+LAG<=cut))
                self.assertTrue(np.all(s.games.time.iloc[te]>=cut))

    def test_later_regular_games_do_not_leak_into_playoffs(self):
        s=load(2025);found=False
        for cut,tr,te in batches(s):
            if (s.games.iloc[te].season_type=='postseason').any():
                found=True
                self.assertFalse(np.any(s.games.time.iloc[tr]+LAG>cut))
        self.assertTrue(found)

    def test_all_models_equal_preseason(self):
        for m in candidates():
            r=m.fit(self.s,np.array([],int),{})
            np.testing.assert_allclose(r,r[0],atol=1e-9,err_msg=m.name)

    def test_missing_plays_fallback(self):
        s=copy.deepcopy(self.s);s.plays=s.plays.iloc[:0]
        score=method('massey',ridge=1.).fit(s,self.tr,{})
        for family in ['epa_units','success_units','epa_margin','success_margin','evidence_blend']:
            m=method(family,ridge=180.,alpha=.5,snaps=400.,disagreement=30.)
            np.testing.assert_allclose(m.fit(s,self.tr,{}),score,atol=1e-9)

    def test_complementary_neural_matchups(self):
        h=self.x[:15];a=self.x[15:30];v=np.ones(15)
        for m in self.model['models']:
            n=Network.fromdict(m)
            np.testing.assert_allclose(n.logits(h,a,v),-n.logits(a,h,-v),atol=1e-12)
            np.testing.assert_allclose(n.logits(h,h,np.zeros(15)),0,atol=1e-12)

    def test_networks_equal_preseason(self):
        z=np.zeros((5,28));p,linear,_=predict(self.model,z,z,np.zeros(5))
        np.testing.assert_array_equal(p,np.ones(5)*.5);np.testing.assert_array_equal(linear,np.ones(5)*.5)

    def test_annual_training_ends_before_forecast_year(self):
        for f in (OUT/'rolling-models').glob('*.json'):
            d=json.loads(f.read_text());self.assertLess(max(d['training_years']),d['year'])

    def test_source_hashes(self):
        sources=json.loads((HERE/'sources.json').read_text())
        for key,item in sources.items():
            if key.isdigit():
                self.assertEqual(digest(INPUT/f'games_{key}.csv'),item['schedule_sha256'])
                self.assertEqual(digest(INPUT/f'plays_{key}.csv'),item['plays_sha256'])
            elif 'path' in item:self.assertEqual(digest(ROOT/item['path']),item['sha256'])
        for year,item in json.loads((HERE/'rich-sources.json').read_text()).items():
            self.assertEqual(digest(INPUT/f'rich_{year}.csv'),item['rich_sha256'])
        self.assertEqual(digest(INPUT/'odds.csv'),json.loads((HERE/'odds-sources.json').read_text())['output_sha256'])

    def test_cfp_lists_contain_25_unique_ranks(self):
        for file in ['cfp.json','cfp-earlier.json']:
            for t in json.loads((INPUT/file).read_text()):
                for j,date in enumerate(t['dates']):
                    values=[r['ranks'][j] for r in t['rows'] if r['ranks'][j] is not None]
                    self.assertEqual(sorted(values),list(range(1,26)),f"{t['year']} {date}")

    def test_saved_predictions_reproduce_metrics(self):
        report=json.loads((OUT/'evaluation.json').read_text());p=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False)
        mask=(p['mode']=='weekly')&p.fbs&p.year.between(2020,2025)
        for method,item in report['overall']['weekly:development'].items():
            valid=mask&p['p_'+method].notna();m=metrics(p.y[valid],p.loc[valid,'p_'+method])
            self.assertEqual(m['games'],item['games'])
            for key in ['accuracy','brier','log_loss']:self.assertAlmostEqual(m[key],item[key],places=8)

    def test_matched_market_metrics(self):
        report=json.loads((OUT/'evaluation.json').read_text());p=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False)
        mask=(p['mode']=='weekly')&p.fbs&p.year.between(2020,2025)&p.p_moneyline_market.notna()
        comparison=report['paired']['weekly:neural_ensemble:vs:moneyline_market']
        for label,method in [('neural','neural_ensemble'),('benchmark','moneyline_market')]:
            m=metrics(p.y[mask],p.loc[mask,'p_'+method]);self.assertAlmostEqual(m['accuracy'],comparison[label]['accuracy'],places=8)

    def test_market_quote_games_are_before_week6_cutoff(self):
        market=pd.read_csv(INPUT/'week6-2026-spreads.csv')
        self.assertTrue(set(market.game_id).issubset(set(self.s.games.iloc[self.tr].game_id)))
        canonical=self.s.games.set_index('game_id')
        self.assertTrue(market.canonical_home_id.eq(market.game_id.map(canonical.home)).all())
        self.assertTrue(market.canonical_away_id.eq(market.game_id.map(canonical.away)).all())
        normal=(market.quote_home_id==market.canonical_home_id)&(market.quote_away_id==market.canonical_away_id)
        reverse=(market.quote_home_id==market.canonical_away_id)&(market.quote_away_id==market.canonical_home_id)
        self.assertTrue((normal|reverse).all())

    def test_rich_graph_features_are_causal_and_anonymous(self):
        from rich_build import extra_features,RICH_NAMES
        from graph_build import graph_features,GRAPH_NAMES
        s=load(2025);_,tr,_=next(batches(s));rich=pd.read_csv(INPUT/'rich_2025.csv')
        original=graph_features(s,tr,rich)
        changed=copy.deepcopy(s);future=np.setdiff1d(np.arange(len(s.games)),tr)
        changed.games.loc[future,['margin','home_points','away_points']]=999
        used=set(s.games.iloc[tr].game_id);future_rich=rich.copy()
        numeric=[c for c in rich.columns if c.endswith('_sum') or c.endswith('_n')]
        future_rich.loc[~future_rich.game_id.isin(used),numeric]=999
        changed.plays.loc[~changed.plays.game_id.isin(used),['epa','success','snaps','special_epa']]=999
        np.testing.assert_array_equal(original,graph_features(changed,tr,future_rich))
        # Rename IDs coherently across every join; no learned identity enters the net.
        renamed=copy.deepcopy(s);mapping={int(t):int(t)+100000 for t in s.ids}
        renamed.ids=renamed.ids+100000;renamed.names=['anonymous']*s.n
        for c in ['home','away']:renamed.games[c]=renamed.games[c].map(mapping)
        rr=rich.copy()
        for c in ['team_id','opponent_id']:rr[c]=rr[c].map(mapping)
        np.testing.assert_allclose(original,graph_features(renamed,tr,rr),atol=1e-10)
        forbidden={'name','id','conference','division','preseason','odds','talent'}
        for names in [RICH_NAMES,GRAPH_NAMES]:
            self.assertFalse(any(forbidden.intersection(n.split('_')) for n in names))

    def test_all_neural_variants_swap_and_reset(self):
        from predict import snapshot,Forecaster,MODELS
        s,_,x=snapshot();model=Forecaster()
        zero={k:np.zeros_like(v) for k,v in x.items()}
        for name in MODELS:
            p=model.probability(x,[0,4,10],[9,8,3],[1,0,-1],name)
            q=model.probability(x,[9,8,3],[0,4,10],[-1,0,1],name)
            np.testing.assert_allclose(p+q,1,atol=1e-12)
            np.testing.assert_allclose(model.probability(zero,[0],[1],[0],name),.5,atol=1e-12)
        rank_model=Network.fromdict(self.model['models'][0])
        np.testing.assert_allclose(rank_model.logits(self.x[:8],self.x[8:16],np.zeros(8)),
            rank_model.team_scores(self.x[:8])-rank_model.team_scores(self.x[8:16]),atol=1e-12)

    def test_analytic_gradients_for_binary_and_soft_labels(self):
        rng=np.random.default_rng(27);h=rng.normal(size=(9,28));a=rng.normal(size=(9,28));h[:,20]=.5;a[:,20]=.4
        for kind,focus,soft in [('rank',0.,True),('matchup',0.,True),('rank',1.,False),('matchup',.5,False)]:
            y=rng.uniform(.1,.9,9) if soft else rng.integers(0,2,9)
            net=Network(kind,4,.01,.03,7,np.ones(28),focus=focus).fit(h,a,np.ones(9),y,rng.normal(0,20,9),
                maxiter=3,sample_weights=np.arange(1,10))
            t=net.theta;_,gradient=net.objective_for_check(t)
            for j in np.linspace(0,len(t)-1,16,dtype=int):
                step=np.zeros(len(t));step[j]=1e-6
                numerical=(net.objective_for_check(t+step)[0]-net.objective_for_check(t-step)[0])/2e-6
                self.assertAlmostEqual(gradient[j],numerical,places=6)

    def test_quote_sides_match_canonical_participants(self):
        odds=pd.read_csv(INPUT/'odds.csv')
        games=pd.concat([pd.read_csv(INPUT/f'games_{y}.csv')[['game_id','home_id','away_id']] for y in range(2002,2026)])
        q=odds.merge(games,on='game_id',validate='one_to_one')
        self.assertTrue(q.canonical_home_id.eq(q.home_id).all())
        self.assertTrue((q.quote_home_id.eq(q.home_id)|q.quote_home_id.eq(q.away_id)).all())

    def test_every_saved_annual_network_uses_earlier_years(self):
        for directory in ['rolling-models','rich-rolling-models','graph-rolling-models','teacher-rolling-models']:
            for path in (OUT/directory).glob('*.json'):
                d=json.loads(path.read_text());self.assertLess(max(d['training_years']),d['year'])

    def test_extended_predictions_reproduce_report(self):
        base=pd.read_csv(OUT/'predictions.csv.gz',low_memory=False);mask=(base['mode']=='weekly')&base.fbs&base.year.between(2020,2025)
        for prefix in ['rich','graph','teacher']:
            p=pd.read_csv(OUT/f'{prefix}-predictions.csv.gz');report=json.loads((OUT/f'{prefix}-evaluation.json').read_text())
            np.testing.assert_array_equal(p.game_id,base.game_id)
            for method,item in report['overall']['weekly'].items():
                actual=metrics(base.y[mask],p.loc[mask,'p_'+method])
                for key in ['accuracy','brier','log_loss']:self.assertAlmostEqual(actual[key],item[key],places=8)

    def test_published_rankings_match_inference(self):
        from predict import snapshot,Forecaster
        s,_,x=snapshot();model=Forecaster()
        ranking=model.ranking(s,x)
        saved=pd.read_csv(OUT/'week6-2026-rankings.csv');saved=saved[(saved.method=='graph_ensemble')&(saved.field=='fbs')]
        self.assertEqual([r['team_id'] for r in ranking],saved.team_id.tolist())
        np.testing.assert_allclose([r['score'] for r in ranking],saved.score,atol=1e-9)

    def test_keener_is_invariant_to_repeating_the_whole_schedule(self):
        m=method('keener',epsilon=.01)
        once=m.fit(self.s,self.tr,{})
        twice=m.fit(self.s,np.r_[self.tr,self.tr],{})
        np.testing.assert_allclose(once,twice,atol=1e-9)

if __name__=='__main__':unittest.main()
