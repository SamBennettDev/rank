"""Paths and explicit imports for the second research study."""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PARENT = HERE.parent
if str(PARENT) not in sys.path:
    sys.path.insert(0, str(PARENT))
INPUT = HERE / 'inputs'
OUT = HERE / 'results'
CACHE = Path('/tmp/rank-season-only/v2')
YEARS = list(range(2006, 2027))
for directory in [INPUT, OUT, CACHE]:
    directory.mkdir(parents=True, exist_ok=True)
