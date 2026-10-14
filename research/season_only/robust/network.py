"""Shared neural strength with evidence shrinkage and a monotone loss deduction."""
from dataclasses import dataclass
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit


@dataclass
class RobustRanker:
    width: int
    ridge: float
    evidence_prior: float
    loss_penalty: float
    seed: int
    scale: np.ndarray
    loss_prior: float = 4.
    clip: float = 4.
    theta: np.ndarray = None
    iterations: int = 0
    converged: bool = False

    def unpack(self, theta):
        d, k = len(self.scale), self.width
        return theta[:d], theta[d:d+d*k].reshape(d, k), theta[d+d*k:d+d*k+k], theta[d+d*k+k:d+d*k+2*k], theta[-1]

    def strength(self, x, games, losses):
        z = np.clip(x / self.scale, -self.clip, self.clip)
        linear, W, b, out, _ = self.unpack(self.theta)
        reliability = games / (games + self.evidence_prior)
        return reliability * (z @ linear + np.tanh(z @ W + b) @ out) - self.loss_penalty * losses / (games + self.loss_prior)

    def logits(self, h, a, hg, ag, hl, al, venue):
        return self.strength(h, hg, hl) - self.strength(a, ag, al) + self.theta[-1] * venue

    def fit(self, h, a, hg, ag, hl, al, venue, y, weights, maxiter=300):
        n, d, k = len(y), len(self.scale), self.width
        x = np.clip(np.r_[h, a] / self.scale, -self.clip, self.clip)
        rel = np.r_[hg / (hg + self.evidence_prior), ag / (ag + self.evidence_prior)]
        sign = np.r_[np.ones(n), -np.ones(n)]
        offset = -self.loss_penalty * (hl / (hg + self.loss_prior) - al / (ag + self.loss_prior))
        weights = weights / np.sum(weights)
        rng = np.random.default_rng(self.seed)
        theta = np.r_[np.zeros(d), rng.normal(0, .08, (d, k)).ravel(), np.zeros(k), rng.normal(0, .03, k), .3]
        theta[0] = self.scale[0] / 12
        penalty = np.ones(len(theta)); penalty[d+d*k:d+d*k+k] = 0; penalty[-1] = .1

        def objective(t):
            linear, W, b, out, home = self.unpack(t)
            hidden = np.tanh(x @ W + b)
            scores = rel * (x @ linear + hidden @ out)
            z = scores[:n] - scores[n:] + offset + home * venue
            loss = np.sum(weights * (np.logaddexp(0, z) - y*z)) + self.ridge * .5 * np.sum(penalty*t*t)
            dz = weights * (expit(z) - y)
            ds = np.r_[dz, dz] * sign * rel
            gh = ds[:, None] * out * (1-hidden**2)
            grad = np.r_[x.T @ ds, (x.T @ gh).ravel(), gh.sum(0), hidden.T @ ds, dz @ venue]
            return loss, grad + self.ridge * penalty * t

        self.objective_for_check = objective
        fit = minimize(objective, theta, jac=True, method='L-BFGS-B',
            options=dict(maxiter=maxiter, ftol=1e-9, gtol=1e-6, maxls=30))
        self.theta = fit.x; self.iterations = fit.nit; self.converged = bool(fit.success)
        assert np.isfinite(self.theta).all()
        return self

    def asdict(self):
        return dict(width=self.width, ridge=self.ridge, evidence_prior=self.evidence_prior,
            loss_penalty=self.loss_penalty, loss_prior=self.loss_prior, clip=self.clip,
            seed=self.seed, scale=self.scale.tolist(), theta=self.theta.tolist(),
            iterations=self.iterations, converged=self.converged)

    @classmethod
    def fromdict(cls, obj):
        obj = dict(obj); obj['scale'] = np.array(obj['scale']); obj['theta'] = np.array(obj['theta'])
        return cls(**obj)


def probability(model, h, a, hg, ag, hl, al, venue):
    z = np.mean([RobustRanker.fromdict(m).logits(h, a, hg, ag, hl, al, venue) for m in model['models']], axis=0)
    return expit(z)
