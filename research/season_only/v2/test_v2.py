"""Meaningful checks of causal features, specialist symmetry, and as-of ingestion."""
import copy
import json
import unittest
import numpy as np
import pandas as pd
from common import INPUT,OUT,CACHE,PARENT
from data import load,batches,week6
from context_features import addon_features,ADDON_NAMES,_player_profile
from model import EvidenceNetwork,early_gate,game_counts,feature_names
from market import validate as validate_quotes,consensus
from availability import validate as validate_events,at_cutoff,resolve_player,adjust_profile
from prepare import digest

class IntegrityV2(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=load(2025);cls.cut,cls.tr,_=week6(cls.s)
        cls.context=pd.read_csv(INPUT/'context_2025.csv');cls.players=pd.read_csv(INPUT/'players_2025.csv')
        cls.x=addon_features(cls.s,cls.tr,cls.context,cls.players,cls.cut)

    def test_future_scores_context_and_players_do_not_change_snapshot(self):
        s=copy.deepcopy(self.s);used=set(s.games.iloc[self.tr].game_id)
        s.games.loc[~s.games.game_id.isin(used),['margin','home_points','away_points']]=999
        s.plays.loc[~s.plays.game_id.isin(used),['epa','snaps','success']]=999
        c=self.context.copy();cols=[n for n in c if n.endswith('_sum') or n.endswith('_n')]
        c.loc[~c.game_id.isin(used),cols]=999
        p=self.players.copy();p.loc[~p.game_id.isin(used),['uses','epa','yards']]=999
        np.testing.assert_array_equal(self.x,addon_features(s,self.tr,c,p,self.cut))

    def test_team_metadata_relabeling_does_not_change_numeric_features(self):
        s=copy.deepcopy(self.s);mapping={int(t):int(t)+100000 for t in s.ids}
        s.ids+=100000;s.names=['anonymous']*s.n
        for col in ['home','away']:s.games[col]=s.games[col].map(mapping)
        for col in ['team_id','opponent_id']:s.plays[col]=s.plays[col].map(mapping)
        c=self.context.copy();p=self.players.copy()
        for frame in [c,p]:
            for col in ['team_id','opponent_id']:frame[col]=frame[col].map(mapping)
        np.testing.assert_allclose(self.x,addon_features(s,self.tr,c,p,self.cut),atol=1e-10)

    def test_player_keys_and_names_are_not_learned_inputs(self):
        p=self.players.copy();mapping={key:f'anonymous_{i}' for i,key in enumerate(p.player_key.unique())}
        p.player_key=p.player_key.map(mapping);p['name']='anonymous';p.athlete_id=np.arange(len(p))+100000
        np.testing.assert_allclose(self.x,addon_features(self.s,self.tr,self.context,p,self.cut),atol=1e-10)
        forbidden={'name','id','conference','division','preseason','odds','recruiting'}
        for kind in ['rich','context','full','graph_context']:
            self.assertFalse(any(forbidden.intersection(n.split('_')) for n in feature_names(kind)))

    def test_equal_start_and_gate_symmetry(self):
        z=addon_features(self.s,np.array([],int),self.context,self.players,self.cut)
        np.testing.assert_array_equal(z,np.zeros_like(z))
        rng=np.random.default_rng(7);h=rng.normal(size=(8,64));a=rng.normal(size=(8,64));h[:,20]=.5;a[:,20]=.7
        np.testing.assert_array_equal(early_gate(h,a),early_gate(a,h))
        np.testing.assert_allclose(game_counts(h),4)
        for kind in ['rank','matchup']:
            n=EvidenceNetwork(kind,4,.01,.03,7,np.ones(64)).fit(h,a,np.ones(8),rng.integers(0,2,8),rng.normal(size=8),maxiter=3)
            np.testing.assert_allclose(n.logits(h,a,np.ones(8)),-n.logits(a,h,-np.ones(8)),atol=1e-12)
            np.testing.assert_array_equal(n.logits(np.zeros((2,64)),np.zeros((2,64)),np.zeros(2)),np.zeros(2))

    def quotes(self):
        return pd.DataFrame([dict(game_id=1,sportsbook='test',market='moneyline',side=side,
            captured_at='2026-10-01T12:00:00Z',available_at='2026-10-01T12:00:00Z',observed_at='2026-10-01T11:59:00Z',
            line=np.nan,odds=price,source='test_fixture',raw_payload_path='unit-test',capture_method='test_fixture',is_live=False)
            for side,price in [('home',-150),('away',130)]])

    def test_market_pairing_freshness_and_future_quotes(self):
        q=validate_quotes(self.quotes());cut=pd.Timestamp('2026-10-01T13:00:00Z')
        p=consensus(q,1,cut);self.assertIsNotNone(p);self.assertGreater(p['value'],.5)
        self.assertIsNone(consensus(q.iloc[:1],1,cut))
        self.assertIsNone(consensus(q,1,'2026-10-03T13:00:00Z',24))
        future=q.copy();future['available_at']=pd.Timestamp('2026-10-02T00:00:00Z')
        self.assertIsNone(consensus(future,1,cut))
        live=q.copy();live['is_live']=True;self.assertIsNone(consensus(live,1,cut))
        changed=q.copy();changed['observed_at']=pd.Timestamp('2026-10-03T00:00:00Z')
        with self.assertRaises(ValueError):validate_quotes(changed)

    def test_no_cross_capture_or_cross_book_pairing(self):
        q=self.quotes();q.loc[1,'sportsbook']='different'
        self.assertIsNone(consensus(validate_quotes(q),1,'2026-10-01T13:00:00Z'))

    def test_one_book_gets_one_vote_across_vendors(self):
        old=self.quotes();old['source']='vendor_one'
        new=self.quotes();new['sportsbook']='TEST';new['source']='vendor_two';new[['captured_at','available_at']]='2026-10-01T12:30:00Z';new['odds']=[-500,350]
        other=self.quotes();other['sportsbook']='other';other['source']='vendor_three';other['odds']=[-250,200]
        expected=(consensus(validate_quotes(new),1,'2026-10-01T13:00:00Z')['value']+
                  consensus(validate_quotes(other),1,'2026-10-01T13:00:00Z')['value'])/2
        actual=consensus(validate_quotes(pd.concat([old,new,other],ignore_index=True)),1,'2026-10-01T13:00:00Z')
        self.assertEqual(actual['books'],2);self.assertAlmostEqual(actual['value'],expected)
        q=self.quotes();q.loc[1,['captured_at','available_at']]='2026-10-01T12:30:00Z'
        self.assertIsNone(consensus(validate_quotes(q),1,'2026-10-01T13:00:00Z'))

    def test_real_quote_archive_round_trip(self):
        q=validate_quotes(pd.read_csv(INPUT/'timestamped_quotes.csv.gz'))
        self.assertGreater(len(q),1000)
        self.assertEqual(digest(INPUT/'timestamped_quotes.csv.gz'),json.loads((OUT/'market-sources.json').read_text())['output_sha256'])

    def test_unknown_report_time_and_inferred_quote_time_are_rejected(self):
        q=self.quotes();q.loc[0,'captured_at']=None
        with self.assertRaises(ValueError):validate_quotes(q)
        q=self.quotes();q['capture_method']='inferred'
        with self.assertRaises(ValueError):validate_quotes(q)
        q=self.quotes();q['captured_at']='2026-10-01T12:00:00'
        with self.assertRaises(ValueError):validate_quotes(q)

    def test_availability_cannot_cross_season_time_game_or_expiry(self):
        events=validate_events(pd.read_csv(INPUT/'availability_events.csv'))
        mateer=events[events.player_name.eq('John Mateer')].iloc[0]
        self.assertTrue(at_cutoff(events,2025,201,'2025-09-22T00:00:00Z',mateer.game_id).empty)
        self.assertTrue(at_cutoff(events,2024,201,'2025-10-01T00:00:00Z',mateer.game_id).empty)
        self.assertTrue(at_cutoff(events,2025,201,'2025-10-01T00:00:00Z',999).empty)
        self.assertTrue(at_cutoff(events,2025,201,'2025-11-01T00:00:00Z',mateer.game_id).empty)
        reports=at_cutoff(events,2025,201,'2025-10-01T00:00:00Z',mateer.game_id)
        self.assertEqual(len(reports),1)

    def test_player_availability_joins_require_unambiguous_identity(self):
        class Report:athlete_id=np.nan;player_name='Same Name'
        p=pd.DataFrame(dict(name=['Same Name','Same Name'],athlete_id=[1,2],player_key=['id:1','id:2']))
        self.assertIsNone(resolve_player(Report(),p));Report.athlete_id=2
        self.assertEqual(resolve_player(Report(),p),'id:2')

    def test_missing_availability_does_not_imply_healthy_or_change_forecast(self):
        own=self.s.games.iloc[self.tr];p=self.players[self.players.game_id.isin(own.game_id)]
        profile=np.arange(16,dtype=float)/16
        result,audit=adjust_profile(profile,own,p,pd.DataFrame())
        np.testing.assert_array_equal(result,profile);self.assertEqual(audit,[])

    def test_source_hashes_for_context_and_players(self):
        for year,item in json.loads((OUT/'context-sources.json').read_text()).items():
            self.assertEqual(digest(INPUT/f'context_{year}.csv'),item['context_sha256'])
            self.assertEqual(digest(INPUT/f'players_{year}.csv'),item['players_sha256'])

    def test_multi_period_selection_has_no_later_outcomes(self):
        protocol=json.loads((OUT/'protocol.json').read_text())
        self.assertEqual(len(protocol['folds']),3)
        for fold in protocol['folds']:
            self.assertLess(max(fold['training']),min(fold['validation']))
            self.assertLess(max(fold['validation']),2020)

    def test_frozen_search_source_has_not_changed(self):
        protocol=json.loads((OUT/'protocol.json').read_text())
        from common import HERE
        for filename,expected in protocol['code_sha256'].items():self.assertEqual(digest(HERE/filename),expected)

    def test_all_annual_fits_end_before_the_forecast_year(self):
        from model import load_model,FEATURE_SETS
        for path in (OUT/'models').glob('*.json.gz'):
            model=load_model(path);self.assertLess(max(model['training_years']),model['year'])
            self.assertEqual(set(model['experts']),{'global','early'})
            for expert in model['experts'].values():
                self.assertEqual(len(expert['models']),3)
                self.assertTrue(all(len(n['scale'])==len(feature_names(model['settings']['feature_set'])) for n in expert['models']))

    def test_saved_evaluation_reproduces_probabilities(self):
        if not (OUT/'evaluation.json').exists():self.skipTest('Annual evaluation not generated yet')
        from evaluate import metrics
        p=pd.read_csv(OUT/'predictions.csv.gz');r=json.loads((OUT/'evaluation.json').read_text())
        mask=(p['mode']=='weekly')&p.fbs&p.year.between(2020,2025)
        for item in r['weekly_development']:
            if item['phase']!='all':continue
            m=metrics(p.y[mask],p.loc[mask,'p_'+item['method']])
            for key in ['accuracy','brier','log_loss']:self.assertAlmostEqual(m[key],item[key],places=8)

    def test_quote_audit_is_before_forecast_cutoff(self):
        if not (OUT/'matched-quote-audit.csv').exists():self.skipTest('Matched quote audit not generated yet')
        q=pd.read_csv(OUT/'matched-quote-audit.csv');cut=pd.to_datetime(q.cutoff,unit='s',utc=True)
        self.assertTrue((pd.to_datetime(q.newest_capture,utc=True,format='mixed')<=cut).all())
        self.assertTrue((pd.to_datetime(q.newest_availability,utc=True,format='mixed')<=cut).all())

    def test_prospective_registration_refuses_overwrite(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        import prospective
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp);path=target/'prospective-registration.json';path.write_text('{"immutable":true}')
            before=digest(path)
            with patch.object(prospective,'OUT',target):prospective.issue()
            self.assertEqual(digest(path),before)

    def test_prospective_grader_rejects_hindsight_and_premature_scores(self):
        import tempfile,contextlib,io
        from pathlib import Path
        from unittest.mock import patch
        import prospective
        from datetime import datetime,timezone
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp);lock=dict(issued_at='2026-10-13T20:00:00Z',fbs_team_ids=[1,2],forecasts=[
                dict(game_id=1,home_id=1,away_id=2,issued_at='2026-10-13T20:00:00Z',p_home=.7,p_v1_home=.6,moneyline_p=.65),
                dict(game_id=2,home_id=1,away_id=3,issued_at='2026-10-13T20:00:00Z',p_home=.8,p_v1_home=.8,moneyline_p=None)])
            (target/'prospective-registration.json').write_text(json.dumps(lock))
            scores=pd.DataFrame([dict(game_id=1,home_id=1,away_id=2,home_points=30,away_points=20,completed=True,
                actual_start='2026-10-20T18:00:00Z',observed_at='2026-10-21T02:00:00Z',source_url='unit-test-fixture')])
            source=target/'scores.csv';scores.to_csv(source,index=False)
            with patch.object(prospective,'OUT',target),patch.object(prospective,'datetime') as clock,contextlib.redirect_stdout(io.StringIO()):
                clock.now.return_value=datetime(2026,11,1,tzinfo=timezone.utc)
                result=prospective.grade(source);self.assertEqual(result['status'],'complete');self.assertEqual(result['registered_fbs_games'],1)
                scores.loc[0,'actual_start']='2026-10-12T18:00:00Z';scores.to_csv(source,index=False)
                with self.assertRaises(ValueError):prospective.grade(source)
                scores.loc[0,'actual_start']='2026-10-20T18:00:00Z';scores.loc[0,'observed_at']='2026-10-20T19:00:00Z';scores.to_csv(source,index=False)
                with self.assertRaises(ValueError):prospective.grade(source)
                scores.loc[0,'observed_at']=None;scores.to_csv(source,index=False)
                with self.assertRaises(ValueError):prospective.grade(source)
                scores.loc[0,'observed_at']='2026-11-02T19:00:00Z';scores.to_csv(source,index=False)
                with self.assertRaises(ValueError):prospective.grade(source)

    def test_availability_audit_matches_only_the_two_competing_teams(self):
        if not (OUT/'availability-pilot-predictions.csv').exists():self.skipTest('Availability pilot has not run')
        p=pd.read_csv(OUT/'availability-pilot-predictions.csv');a=pd.read_csv(OUT/'availability-join-audit.csv')
        self.assertTrue((p.matched_reports<=p.reports).all())
        self.assertEqual(int(p.reports.sum()),len(a))
        self.assertEqual(int(p.matched_reports.sum()),int(a.matched.sum()))

    def test_prospective_models_and_original_benchmark_are_preserved(self):
        if not (OUT/'prospective-registration.json').exists():self.skipTest('Prospective registry not issued')
        lock=json.loads((OUT/'prospective-registration.json').read_text())
        self.assertEqual(digest(OUT/'prospective-model.json.gz'),lock['model_sha256'])
        self.assertEqual(digest(OUT/'prospective-feature-snapshot.npz'),lock['feature_snapshot_sha256'])
        original=digest(OUT/'prospective-inputs/timestamped_quotes.csv.gz')
        expected=next(v for k,v in lock['input_sha256'].items() if k.endswith('/timestamped_quotes.csv.gz'))
        self.assertEqual(original,expected)
        self.assertEqual(digest(OUT/'prospective-code/market.py'),lock['code_sha256']['market.py'])
        add=json.loads((OUT/'prospective-market-addendum.json').read_text())
        self.assertEqual(add['registration_sha256'],digest(OUT/'prospective-registration.json'))
        self.assertLess(pd.Timestamp(add['recorded_at']),min(pd.Timestamp(r['scheduled_start']) for r in lock['forecasts']))

if __name__=='__main__':unittest.main()
