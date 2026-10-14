import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from robust.features import INDICES, inputs, records
from robust.network import RobustRanker
from robust.bounded_network import BoundedRanker


class RobustTests(unittest.TestCase):
    def model(self):
        rng = np.random.default_rng(7)
        x, a = rng.normal(size=(12, 50)), rng.normal(size=(12, 50))
        games = np.arange(1, 13, dtype=float)
        losses = games // 2
        model = RobustRanker(width=8, ridge=.01, evidence_prior=6., loss_penalty=2., seed=7, scale=np.ones(50))
        model.fit(x, a, games, games, losses, losses, np.ones(12), np.arange(12) % 2, np.ones(12), maxiter=3)
        return model, x, games, losses

    def test_objective_gradient(self):
        model, _, _, _ = self.model()
        objective = model.objective_for_check
        _, analytical = objective(model.theta)
        rng = np.random.default_rng(19)
        for i in rng.choice(len(model.theta), 25, replace=False):
            delta = np.zeros(len(model.theta)); delta[i] = 1e-5
            numerical = (objective(model.theta+delta)[0]-objective(model.theta-delta)[0])/(2e-5)
            self.assertAlmostEqual(analytical[i], numerical, places=7)

    def test_monotone_loss_deduction_and_equal_starts(self):
        model, x, games, losses = self.model()
        original = model.strength(x, games, losses)
        changed = model.strength(x, games, losses+1)
        np.testing.assert_allclose(original-changed, model.loss_penalty/(games+model.loss_prior), atol=1e-14)
        np.testing.assert_array_equal(model.strength(x, np.zeros(12), np.zeros(12)), np.zeros(12))
        z = model.logits(x, x[::-1], games, games[::-1], losses, losses[::-1], np.ones(12))
        reverse = model.logits(x[::-1], x, games[::-1], games, losses[::-1], losses, -np.ones(12))
        np.testing.assert_allclose(z, -reverse, atol=1e-14)

    def test_raw_scores_and_record_features_are_excluded(self):
        raw = np.zeros((3, 152))
        changed = raw.copy()
        changed[:, [0, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 23, 26, 27, 64, 82]] = 1e6
        np.testing.assert_array_equal(inputs(raw), inputs(changed))
        changed[:, 65] = 3
        self.assertTrue(np.all(inputs(changed)[:, INDICES.index(18)] == 3))

    def test_record_counts_round_trip(self):
        raw = np.zeros((3, 152))
        raw[:, 20] = np.array([0., 5., 6.])/(np.array([0., 5., 6.])+4)
        raw[:, 17] = [0., .1, 1/3]
        games, losses = records(raw)
        np.testing.assert_array_equal(games, [0, 5, 6])
        np.testing.assert_array_equal(losses, [0, 2, 1])


class BoundedTests(RobustTests):
    def model(self):
        rng=np.random.default_rng(7)
        x,a=rng.normal(size=(12,50)),rng.normal(size=(12,50))
        games=np.arange(1,13,dtype=float);losses=games//2
        model=BoundedRanker(ridge=.003,evidence_prior=2.,residual_limit=.5,anchor_scale=10.,seed=7,scale=np.ones(50))
        model.fit(x,a,games,games,losses,losses,np.ones(12),np.arange(12)%2,np.ones(12),maxiter=3)
        model.loss_penalty=2.
        return model,x,games,losses

    def test_residual_is_bounded(self):
        model,x,games,losses=self.model()
        strength=model.strength(x,games,losses)+model.loss_penalty*losses/(games+model.loss_prior)
        residual=strength/(games/(games+model.evidence_prior))-x[:,1]/model.anchor_scale
        self.assertTrue(np.all(np.abs(residual)<=model.residual_limit))

    def test_extra_score_margin_above_cap_cannot_change_features(self):
        from dataclasses import replace
        import pandas as pd
        from data import load,week6
        from prepare import ROOT
        from robust.capped_features import build
        s=load(2026);_,idx,_=week6(s)
        rich=pd.read_csv(ROOT/'data/seasons/2026/rich.csv')
        baseline,records=build(s,idx,rich)
        games=s.games.copy();row=games.index[games.game_id.eq(401858455)][0]
        self.assertEqual(games.loc[row,'margin'],84)
        games.loc[row,'home_points']=35;games.loc[row,'margin']=35
        changed,changed_records=build(replace(s,games=games),idx,rich)
        np.testing.assert_allclose(baseline,changed,atol=1e-10,rtol=0)
        for a,b in zip(records,changed_records):np.testing.assert_array_equal(a,b)


if __name__ == '__main__': unittest.main()
