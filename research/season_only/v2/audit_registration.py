"""Append a benchmark-only correction before registered games begin.

Preserves the original registration, original quote input, original capture code,
and all model forecasts. Corrections do not obtain later information: eligibility
remains bounded at the original issuance time.
"""
import json
from datetime import datetime,timezone
import pandas as pd
from common import INPUT,OUT
from prepare import digest
from market import load_quotes,consensus

def main():
    path=OUT/'prospective-market-addendum.json'
    if path.exists():raise ValueError('The benchmark addendum already exists and cannot be replaced')
    original=OUT/'prospective-registration.json';lock=json.loads(original.read_text());now=datetime.now(timezone.utc)
    first=min(pd.Timestamp(r['scheduled_start']) for r in lock['forecasts'])
    if pd.Timestamp(now)>=first:raise ValueError('A prospective correction must precede the first registered game')
    quotes=load_quotes();rows=[]
    for row in lock['forecasts']:
        q=consensus(quotes,row['game_id'],lock['issued_at'],24,'moneyline')
        rows.append(dict(game_id=row['game_id'],original_probability=row['moneyline_p'],
            corrected_probability=q['value'] if q else None,quote=q))
    addendum=dict(recorded_at=now.isoformat(),registration_sha256=digest(original),original_issued_at=lock['issued_at'],
        reason='Normalize sportsbook case aliases (Bet365/bet365) to one book identity; exclude raw payload references absent from the pinned Git tree. No model prediction changes.',
        eligibility='All corrected quotes still must have been observed, captured, and available by original issuance, and be at most 24 hours old.',
        original_quotes_sha256=digest(OUT/'prospective-inputs/timestamped_quotes.csv.gz'),
        original_market_code_sha256=digest(OUT/'prospective-code/market.py'),
        corrected_quotes_sha256=digest(INPUT/'timestamped_quotes.csv.gz'),corrected_market_code_sha256=digest(__import__('pathlib').Path(__file__).with_name('market.py')),
        source_manifest_sha256=digest(OUT/'market-sources.json'),quotes=rows)
    with path.open('x') as f:json.dump(addendum,f,indent=2);f.write('\n')
    changed=sum(r['original_probability']!=r['corrected_probability'] for r in rows)
    print('Preserved original registration; appended benchmark correction for',changed,'prices; model forecasts unchanged',flush=True)

if __name__=='__main__':main()
