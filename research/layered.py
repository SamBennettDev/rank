"""Layered (division + conference + team) margin ratings with optional censoring, robust loss, win bonus and home field."""
import numpy as np

def fit(S, idx, C=1e9, bonus=0.0, delta=1e6, lam_t=0.005, lam_c=0.002, lam_d=0.0005, hfa_fit=True, decay=1.0, layers=True, iters=100, return_parts=False):
    n = S.n; nc = int(S.conf.max()) + 1
    h, a = S.home[idx], S.away[idx]
    m = (S.hp[idx] - S.ap[idx]).astype(float); sgn = np.sign(m)
    y = m + bonus * sgn; cens = np.abs(m) > C; ycap = sgn * (C + bonus)
    home = (~S.neutral[idx]).astype(float) if hfa_fit else np.zeros(len(idx))
    wgt = decay ** (S.order[idx].max() - S.order[idx]).astype(float)
    # Z maps parameters [team n | conf nc | div 2] to team ratings
    K = n + (nc + 2 if layers else 0)
    Z = np.zeros((n, K)); Z[np.arange(n), np.arange(n)] = 1
    if layers: Z[np.arange(n), n + S.conf] = 1; Z[np.arange(n), n + nc + S.fbs] = 1
    lam = np.full(K + 1, lam_t)
    if layers: lam[n:n + nc] = lam_c; lam[n + nc:K] = lam_d
    lam[K] = 1e-4
    th = np.zeros(K + 1)
    def mu_of(th):
        R = Z @ th[:K]; return R[h] - R[a] + th[K] * home, R
    KAP = 2.0  # smoothing of the censored shortfall, in points
    def resid(mu):
        """Residual per game and its derivative wrt mu. Censored games use a smooth shortfall max(0, z)."""
        z = sgn * (ycap - mu)                      # how far expected falls short of the censor point
        sq = np.sqrt(z * z + KAP * KAP)
        sc = (z + sq) / 2                          # smooth max(0, z) > 0
        dsc = -sgn * (1 + z / sq) / 2              # d sc / d mu
        d2sc = (KAP * KAP) / (4 * sq ** 3)          # d2 sc / d mu2 (sgn^2 = 1)
        rc = np.where(cens, sc, y - mu)
        drc = np.where(cens, dsc, -1.0)
        d2rc = np.where(cens, d2sc, 0.0)
        return rc, drc, d2rc
    def obj(th):
        mu, _ = mu_of(th); rc, _, _ = resid(mu)
        return (wgt * delta**2 * (np.sqrt(1 + (rc / delta) ** 2) - 1)).sum() + (lam * th * th).sum()
    for _ in range(iters):
        mu, R = mu_of(th); rc, drc, d2rc = resid(mu)
        q = np.sqrt(1 + (rc / delta) ** 2); dl = rc / q; d2 = 1 / q ** 3
        gmu = wgt * dl * drc                              # d obj / d mu per game
        hmu = wgt * (d2 * drc ** 2 + dl * d2rc)           # d2 obj / d mu2 per game (>= 0: dl >= 0 where d2rc > 0)
        gR = np.bincount(h, gmu, n) - np.bincount(a, gmu, n)
        g = np.concatenate([Z.T @ gR, [(gmu * home).sum()]]) + 2 * lam * th
        L = np.zeros((n, n)); np.add.at(L, (h, h), hmu); np.add.at(L, (a, a), hmu); np.add.at(L, (h, a), -hmu); np.add.at(L, (a, h), -hmu)
        hv = np.bincount(h, hmu * home, n) - np.bincount(a, hmu * home, n)   # cross term team-rating x hfa
        H = np.zeros((K + 1, K + 1)); H[:K, :K] = Z.T @ L @ Z
        H[:K, K] = Z.T @ hv; H[K, :K] = H[:K, K]; H[K, K] = (hmu * home * home).sum()
        H += 2 * np.diag(lam)
        step = np.linalg.solve(H, -g)
        e0 = obj(th); t = 1.0
        while obj(th + t * step) > e0 and t > 1e-10: t /= 2
        th = th + t * step
        if np.abs(step).max() * t < 1e-8: break
    R = Z @ th[:K]
    return (R, th) if return_parts else R
