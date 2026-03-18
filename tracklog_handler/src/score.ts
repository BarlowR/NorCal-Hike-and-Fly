import { Point } from "igc-xc-score/src/foundation.js";
import { scoreTrack } from "./hf_scoring.js";

export interface ScoreBreakdown {
  triangle_km: number;
  penalty_km: number;
  hiking_km: number;
  multiplier: number;
  closed: boolean;
  scoring_code: string;
}

export interface TrackData {
  flightSegments: { takeoffMs: number; landingMs: number }[];
  scoreInfo: { tp: any[]; cp: any; ep: any; distance: number; penalty: number };
  scoring: { code: string; multiplier: number };
  groundDist: number;
  closed: boolean;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  trackData: TrackData;
  date: string;
  duration_s: number;
  distance_km: number;
}

export async function scoreIgc(igcContent: string): Promise<ScoreResult> {
  const result = await scoreTrack(igcContent);
  if (!result) {
    throw new Error("Scoring failed");
  }

  const { best, flight, groundDist, closed, score: flightScore } = result;

  // Date from first fix
  const firstFix = flight.fixes[0];
  const lastFix = flight.fixes[flight.fixes.length - 1];
  const date = new Date(firstFix.timestamp).toISOString().split("T")[0];

  // Duration
  const duration_s = Math.round(
    (lastFix.timestamp - firstFix.timestamp) / 1000
  );

  // Total distance (fix-to-fix)
  let totalDistKm = 0;
  for (let i = 1; i < flight.fixes.length; i++) {
    totalDistKm += new Point(flight.fixes, i - 1).distanceEarth(
      new Point(flight.fixes, i)
    );
  }

  // Compute flight segments (takeoff/landing timestamps) from analyzed fixes.
  // Using timestamps rather than indexes so the client can apply them to the
  // raw IGC/GPX (which may include fixes outside the 8am-5pm time window).
  const analyzedFixes: any[] = (flight as any).filtered ?? flight.fixes;
  const flightSegments: TrackData["flightSegments"] = [];
  let inFlight = false;
  let takeoffMs = 0;
  for (let i = 0; i < analyzedFixes.length; i++) {
    const airborne = !analyzedFixes[i].onGround;
    if (!inFlight && airborne) {
      inFlight = true;
      takeoffMs = analyzedFixes[i].timestamp;
    } else if (inFlight && !airborne) {
      inFlight = false;
      flightSegments.push({ takeoffMs, landingMs: analyzedFixes[i - 1].timestamp });
    }
  }
  if (inFlight) {
    flightSegments.push({ takeoffMs, landingMs: analyzedFixes[analyzedFixes.length - 1].timestamp });
  }

  // Extract plain objects from Point class instances for JSON serialization
  const rawTp = (best.scoreInfo?.tp ?? []).map((p: any) => ({ x: p.x, y: p.y, r: p.r }));
  const cp = best.scoreInfo?.cp;
  const rawCp = cp?.in && cp?.out
    ? {
        d: cp.d,
        in: { x: cp.in.x, y: cp.in.y, r: cp.in.r },
        out: { x: cp.out.x, y: cp.out.y, r: cp.out.r },
      }
    : null;
  const ep = best.scoreInfo?.ep;
  const rawEp = ep?.start && ep?.finish
    ? {
        start: { x: ep.start.x, y: ep.start.y, r: ep.start.r },
        finish: { x: ep.finish.x, y: ep.finish.y, r: ep.finish.r },
      }
    : null;

  const trackData: TrackData = {
    flightSegments,
    scoreInfo: {
      tp: rawTp,
      cp: rawCp,
      ep: rawEp,
      distance: best.scoreInfo?.distance ?? 0,
      penalty: best.scoreInfo?.penalty ?? 0,
    },
    scoring: {
      code: best.opt.scoring.code,
      multiplier: best.opt.scoring.multiplier,
    },
    groundDist,
    closed,
  };

  return {
    score: flightScore,
    breakdown: {
      triangle_km: best.scoreInfo?.distance ?? 0,
      penalty_km: best.scoreInfo?.penalty ?? 0,
      hiking_km: groundDist,
      multiplier: best.opt.scoring.multiplier,
      closed,
      scoring_code: best.opt.scoring.code,
    },
    trackData,
    date,
    duration_s,
    distance_km: totalDistKm,
  };
}
