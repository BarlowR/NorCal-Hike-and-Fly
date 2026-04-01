import { Point } from "igc-xc-score/src/foundation.js";
import { scoreTrack } from "./hf_scoring.js";

export interface ScoreBreakdown {
  triangle_km: number;
  penalty_km: number;
  hiking_km: number;
  hiking_elevation_gain: number;
  multiplier: number;
  closed: boolean;
  scoring_code: string;
  base_score: number;
  friends_bonus: boolean;
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
  launch_lat: number;
  launch_lon: number;
}

export const FRIENDS_RADIUS_KM = 5;
export const FRIENDS_MIN_GROUP = 4;
export const FRIENDS_MULTIPLIER = 1.5;

export interface FlightRef {
  id: string;
  date: string;
  launch_lat: number;
  launch_lon: number;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Returns the set of flight IDs (as passed in FlightRef.id) that qualify for
 * the friends group bonus: 4+ flights on the same day starting within
 * FRIENDS_RADIUS_KM of each other.
 */
export function computeFriendsBonus(flights: FlightRef[]): Set<string> {
  const qualifying = new Set<string>();
  const byDate = new Map<string, FlightRef[]>();
  for (const f of flights) {
    if (f.launch_lat === 0 && f.launch_lon === 0) continue;
    if (!byDate.has(f.date)) byDate.set(f.date, []);
    byDate.get(f.date)!.push(f);
  }
  for (const dayFlights of byDate.values()) {
    if (dayFlights.length < FRIENDS_MIN_GROUP) continue;
    for (const f of dayFlights) {
      const nearbyCount = dayFlights.filter(
        (g) => g.id !== f.id && haversineKm(f.launch_lat, f.launch_lon, g.launch_lat, g.launch_lon) <= FRIENDS_RADIUS_KM
      ).length;
      if (nearbyCount >= FRIENDS_MIN_GROUP - 1) {
        qualifying.add(f.id);
      }
    }
  }
  return qualifying;
}

export async function scoreIgc(igcContent: string): Promise<ScoreResult> {
  const result = await scoreTrack(igcContent);
  if (!result) {
    throw new Error("Scoring failed");
  }

  const { best, flight, groundDist, hikingElevationGain, closed, score: flightScore } = result;

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
      hiking_elevation_gain: hikingElevationGain,
      multiplier: best.opt.scoring.multiplier,
      closed,
      scoring_code: best.opt.scoring.code,
      base_score: flightScore,
      friends_bonus: false,
    },
    trackData,
    date,
    duration_s,
    distance_km: totalDistKm,
    launch_lat: firstFix.latitude,
    launch_lon: firstFix.longitude,
  };
}
