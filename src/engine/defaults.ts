import type { MatchupSettings, SpringSettings } from "./types";

/** The ranking: two passes of the spring graph (chosen on 2014–2019). */
export const DEFAULT_SPRINGS: SpringSettings = {
  strengthShrink: 0.2,
  qualityScale: 1.5,
  rankShrink: 0.1,
};

/** The matchup-prediction model (calibrated on 2014–2019). */
export const DEFAULT_MATCHUP: MatchupSettings = {
  winBonus: 3,
  divisionGap: 31.644079,
  shrink: 1,
  homeField: 2.668394,
  homeFieldShrink: 64,
  probabilityScale: 12,
  residualScale: 14.934045,
  calibrationId: "matchup-2014-2019",
};

export const DEFAULT_SETTINGS = {
  algorithmVersion: "two-pass-springs-2",
  classifications: ["fbs", "fcs"],
  springs: DEFAULT_SPRINGS,
  matchup: DEFAULT_MATCHUP,
  unitShrink: 0.05,
};
