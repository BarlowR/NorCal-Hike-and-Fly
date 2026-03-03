/**
 * Note from Rob: This code is taken from the igc-xc-score module as
 * the analyze function is not made available by the module.
 * Modifications have been made to keep track of distance and to
 * remove fixes where both stateFlight and stateGround are false.
 */

/* Launch and landing detection can affect the score,
 * and must be as precise as possible
 *
 * Launch and landing are detected on a n-second moving average
 * of the horizontal and vertical speed
 *
 * maPeriod is the number of seconds for the moving average
 *
 * t is the number of seconds that the conditions must be true
 * (the event is still assigned to the start of the period)
 *
 * x is the horizontal speed in m/s
 *
 * z is the absolute value of the vertical speed in m/s
 *
 * Launch/landing is detected when both of the moving averages
 * cross the detection threshold for t seconds
 */
const maPeriod = 10;
const definitionFlight = {
  t: 10,
  x0: 1.5,
  xt: 5,
  z0: 0.05,
  zt: 0.3,   // lowered from 0.9; GPX altitude smoothing suppresses vspeed
};

const definitionGround = {
  xmax: 5,
  zmax: 0.5,
};

// detectLaunchLanding tuning
const MERGE_FLIGHT_GAP_MS = 180_000;  // merge stateFlight blocks < 3 min apart
const SUSTAINED_GROUND_MS = 30_000;   // require 30 s of stateGround to confirm landing
const LAUNCH_HSPEED_MAX   = 1.5;      // m/s: walk back to last clearly-ground speed

import { Point } from 'igc-xc-score/src/foundation.js';

interface Fix {
  timestamp: number;
  latitude: number;
  longitude: number;
  pressureAltitude: number | null;
  gpsAltitude: number | null | undefined;
  valid: boolean;
  dist?: number;
  hspeed?: number;
  vspeed?: number;
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

function prepare(fixes: Fix[]) {
  for (let i = 0; i < fixes.length; i++) {
    if (
      fixes[i].pressureAltitude == null ||
      fixes[i].pressureAltitude! < -1000
    )
      fixes[i].pressureAltitude = fixes[i].gpsAltitude as number;
    if (fixes[i].pressureAltitude === null) fixes[i].gpsAltitude = undefined;

    if (i > 0) {
      const deltaTimestamp = fixes[i].timestamp - fixes[i - 1].timestamp;
      if (deltaTimestamp > 0) {
        fixes[i].dist = new Point(fixes, i - 1).distanceEarth(
          new Point(fixes, i)
        );
        fixes[i].hspeed =
          fixes[i].dist! * 1000 / deltaTimestamp * 1000;
        fixes[i].vspeed =
          (fixes[i].pressureAltitude! - fixes[i - 1].pressureAltitude!) /
            deltaTimestamp * 1000;
      } else {
        fixes[i].hspeed = fixes[i - 1].hspeed;
        fixes[i].vspeed = fixes[i - 1].vspeed;
      }
    } else {
      fixes[i].hspeed = 0;
      fixes[i].vspeed = 0;
    }
  }

  for (let i = 0; i < fixes.length; i++) {
    const now = fixes[i].timestamp;
    let start: number, end: number;
    for (
      start = i;
      start > 0 &&
      fixes[start].timestamp > now - Math.round((maPeriod * 1000) / 2);
      start--
    );
    for (
      end = i;
      end < fixes.length - 1 &&
      fixes[end].timestamp < now + Math.round((maPeriod * 1000) / 2);
      end++
    );
    const maSegment = fixes.slice(start, end + 1);
    fixes[i].hma =
      maSegment.reduce((sum, x) => sum + x.hspeed!, 0) / maSegment.length;
    fixes[i].vma =
      maSegment.reduce((sum, x) => sum + Math.abs(x.vspeed!), 0) /
      maSegment.length;
  }
}

function detectFlight(fixes: Fix[]) {
  let start: number | undefined;
  for (let i = 0; i < fixes.length - 1; i++) {
    if (
      start === undefined &&
      fixes[i].hma! > definitionFlight.xt &&
      fixes[i].vma! > definitionFlight.zt
    )
      start = i;
    if (start !== undefined)
      if (
        fixes[i].hma! > definitionFlight.x0 &&
        fixes[i].vma! > definitionFlight.z0
      ) {
        if (
          fixes[i].timestamp >
          fixes[start].timestamp + definitionFlight.t * 1000
        )
          for (let j = start; j <= i; j++) fixes[j].stateFlight = true;
      } else {
        start = undefined;
      }
  }
}

function detectGround(fixes: Fix[]) {
  for (let i = 0; i < fixes.length; i++) {
    if (
      fixes[i].hma! < definitionGround.xmax &&
      fixes[i].vma! < definitionGround.zmax
    )
      fixes[i].stateGround = true;
  }
}

function detectLaunchLanding(fixes: Fix[]) {
  // 1. Find contiguous stateFlight blocks.
  const blocks: Array<{ start: number; end: number }> = [];
  let blockStart = -1;
  for (let i = 0; i < fixes.length; i++) {
    if (blockStart < 0 && fixes[i].stateFlight) {
      blockStart = i;
    } else if (blockStart >= 0 && !fixes[i].stateFlight) {
      blocks.push({ start: blockStart, end: i - 1 });
      blockStart = -1;
    }
  }
  if (blockStart >= 0) blocks.push({ start: blockStart, end: fixes.length - 1 });

  // 2. Merge adjacent blocks whose gap is within MERGE_FLIGHT_GAP_MS.
  //    This handles brief slow sections mid-flight that briefly drop below thresholds.
  const merged: typeof blocks = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      fixes[block.start].timestamp - fixes[prev.end].timestamp <= MERGE_FLIGHT_GAP_MS
    ) {
      prev.end = block.end;
    } else {
      merged.push({ ...block });
    }
  }

  // 3. For each merged block find launch and landing.
  const ll: Array<{ launch: number; landing: number }> = [];
  for (const { start, end } of merged) {
    // Launch: walk back from block start to the last fix where the pilot was
    // clearly on the ground (hma < LAUNCH_HSPEED_MAX ≈ walking speed).
    let launch = 0;
    for (let j = start - 1; j >= 0; j--) {
      if (fixes[j].hma! < LAUNCH_HSPEED_MAX) {
        launch = j;
        break;
      }
    }

    // Landing: walk forward from block end to the first stateGround fix that
    // is sustained for at least SUSTAINED_GROUND_MS (avoids slow mid-flight
    // sections being mistaken for a landing).
    let landing = fixes.length - 1;
    for (let j = end; j < fixes.length; j++) {
      if (fixes[j].stateGround) {
        const t0 = fixes[j].timestamp;
        let k = j + 1;
        while (k < fixes.length && fixes[k].stateGround) k++;
        const duration = fixes[k - 1].timestamp - t0;
        if (duration >= SUSTAINED_GROUND_MS || k >= fixes.length) {
          landing = j;
          break;
        }
        j = k - 1;  // not sustained — skip past this ground section
      }
    }

    ll.push({ launch, landing });
  }

  // 4. Mark onGround for all fixes.
  for (const fix of fixes) fix.onGround = true;
  for (const { launch, landing } of ll) {
    for (let i = launch + 1; i < landing; i++) fixes[i].onGround = false;
  }

  return ll;
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

  if (
    config.trim ||
    config.detectLaunch ||
    config.detectLanding ||
    config.analyze
  ) {
    prepare(flight.filtered);
    detectFlight(flight.filtered);
    detectGround(flight.filtered);
    flight.ll = detectLaunchLanding(flight.filtered);
  } else
    flight.ll = [{ launch: 0, landing: flight.filtered.length - 1 }];
}
