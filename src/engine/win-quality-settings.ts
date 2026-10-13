import type { WinQualitySettings } from "./types";

/** Calibrated on 2014–2019, independently of the current teams and standings. */
export const DEFAULT_WIN_QUALITY: WinQualitySettings = {
  reference: "fbs",
  divisionGap: 31.644079,
  shrink: 1,
  homeField: 2.668394,
  homeFieldShrink: 64,
  winScale: 2,
  calibrationId: "win-quality-fbs-reference-2014-2019-v2",
};
