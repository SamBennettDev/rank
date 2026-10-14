"""A score-resistant whitelist, plus explicit season-only record evidence."""
import numpy as np
from graph_build import GRAPH_NAMES

# Exclude raw margin, raw score, raw EPA averages, margin variation, Elo and
# record ratings. Record effects have their own monotone loss branch.
INDICES = [1, 2, 9, 10, 11, 12, 13, 18, 19, 20, 21, 22, 24, 25] + list(range(28, 64))
NAMES = [GRAPH_NAMES[j] if j != 18 else 'capped_opponent_margin_mean' for j in INDICES]


def inputs(graph):
    graph = np.asarray(graph)
    x = graph[:, INDICES].copy()
    x[:, INDICES.index(18)] = graph[:, 65]  # Opponent mean of capped, not raw, margin.
    return x


def records(graph):
    """Recover integer counts from the existing exact game-evidence feature."""
    graph = np.asarray(graph)
    evidence = graph[:, 20]
    games = np.rint(4 * evidence / np.maximum(1 - evidence, 1e-12)).astype(int)
    losses = np.rint(games * (.5 - graph[:, 17])).astype(int)
    assert np.all((losses >= 0) & (losses <= games))
    return games, losses
