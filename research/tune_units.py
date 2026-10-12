import sys, json
from functools import partial
from multiprocessing import Pool
import units
from bench import evaluate, fbs_mask
TRAIN = [2015, 2016, 2017, 2018, 2019]
def run(cfg):
    r = evaluate(partial(units.fit, **cfg), TRAIN, retro=False)
    m = fbs_mask(TRAIN)
    return cfg, r["acc"], r["outcomes"][m].mean(), m.sum()
if __name__ == "__main__":
    cfgs = json.loads(sys.argv[1])
    with Pool(4) as p:
        for cfg, acc, fb, n in sorted(p.map(run, cfgs), key=lambda x: -x[2]):
            print(f"all {acc*100:6.2f}%  FBS-v-FBS {fb*100:6.2f}% (n={n}) {cfg}", flush=True)
