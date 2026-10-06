/**
 * Thin wrapper around the hike-fly-detect package.
 *
 * The detection algorithm (derived from igc-xc-score) lives in
 * https://github.com/BarlowR/hike-fly-detect. This file keeps the
 * analyze(flight, config) signature that hf_scoring.ts, score.ts,
 * run_tests.ts and the site components call, and copies the column
 * results back onto the fix objects those readers expect.
 */

import { analyzeTrack } from 'hike-fly-detect';

interface Fix {
  timestamp: number;
  latitude: number;
  longitude: number;
  pressureAltitude: number | null;
  gpsAltitude: number | null | undefined;
  valid: boolean;
  hma?: number;
  vma?: number;
  stateFlight?: boolean;
  stateGround?: boolean;
  onGround?: boolean;
}

interface Flight {
  fixes: Fix[];
  filtered?: Fix[];
  ll?: Array<{ launch: number; landing: number }>;
}

interface AnalyzeConfig {
  invalid?: boolean;
  trim?: boolean;
  detectLaunch?: boolean;
  detectLanding?: boolean;
  analyze?: boolean;
}

export function analyze(flight: Flight, config: AnalyzeConfig) {
  if (!config.invalid)
    flight.filtered = flight.fixes
      .filter((x) => x.valid)
      .filter((x, i, a) => i == 0 || a[i - 1].timestamp !== x.timestamp);
  else flight.filtered = flight.fixes.slice(0);
  if (flight.filtered.length < 5)
    throw new Error(
      "Flight must contain at least 5 valid GPS fixes, " +
        `${flight.filtered.length} valid fixes found (out of ${flight.fixes.length})`
    );

  const fixes = flight.filtered;

  if (
    config.trim ||
    config.detectLaunch ||
    config.detectLanding ||
    config.analyze
  ) {
    // Altitude fallback: hf_scoring.ts reads pressureAltitude after this call.
    for (const fix of fixes) {
      if (fix.pressureAltitude == null || fix.pressureAltitude < -1000)
        fix.pressureAltitude = fix.gpsAltitude as number;
      if (fix.pressureAltitude === null) fix.gpsAltitude = undefined;
    }

    const result = analyzeTrack({
      timeMs: fixes.map((f) => f.timestamp),
      lat: fixes.map((f) => f.latitude),
      lon: fixes.map((f) => f.longitude),
      alt: fixes.map((f) => f.pressureAltitude as number),
    });

    for (let i = 0; i < fixes.length; i++) {
      fixes[i].hma = result.hma[i];
      fixes[i].vma = result.vma[i];
      fixes[i].stateFlight = result.stateFlight[i] === 1;
      fixes[i].stateGround = result.stateGround[i] === 1;
      fixes[i].onGround = result.onGround[i] === 1;
    }
    flight.ll = result.segments;
  } else flight.ll = [{ launch: 0, landing: fixes.length - 1 }];
}
