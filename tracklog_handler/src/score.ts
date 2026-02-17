import { Point } from "igc-xc-score/src/foundation.js";
import { score } from "./hf_scoring.js";

export interface ScoreBreakdown {
  triangle_km: number;
  penalty_km: number;
  hiking_km: number;
  multiplier: number;
  closed: boolean;
}

export interface TrackData {
  fixes: { latitude: number; longitude: number; onGround: boolean }[];
  scoreInfo: { tp: any[]; cp: any; ep: any; distance: number; penalty: number };
  scoring: { code: string; multiplier: number };
  groundDist: number;
  closed: boolean;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  coordinates: [number, number, number][];
  trackData: TrackData;
  date: string;
  duration_s: number;
  distance_km: number;
}

export async function scoreIgc(igcContent: string): Promise<ScoreResult> {
  const result = await score(igcContent);
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

  // Downsample coordinates to ~500 points
  const stride = Math.max(1, Math.floor(flight.fixes.length / 500));
  const coordinates: [number, number, number][] = [];
  const downsampledFixes: TrackData["fixes"] = [];
  for (let i = 0; i < flight.fixes.length; i += stride) {
    const fix = flight.fixes[i];
    coordinates.push([
      fix.latitude,
      fix.longitude,
      fix.gpsAltitude ?? fix.pressureAltitude ?? 0,
    ]);
    downsampledFixes.push({
      latitude: fix.latitude,
      longitude: fix.longitude,
      onGround: !!fix.onGround,
    });
  }
  // Always include last fix
  if (flight.fixes.length > 0) {
    const last = flight.fixes[flight.fixes.length - 1];
    const lastCoord: [number, number, number] = [
      last.latitude,
      last.longitude,
      last.gpsAltitude ?? last.pressureAltitude ?? 0,
    ];
    if (
      coordinates.length === 0 ||
      coordinates[coordinates.length - 1][0] !== lastCoord[0] ||
      coordinates[coordinates.length - 1][1] !== lastCoord[1]
    ) {
      coordinates.push(lastCoord);
      downsampledFixes.push({
        latitude: last.latitude,
        longitude: last.longitude,
        onGround: !!last.onGround,
      });
    }
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
    fixes: downsampledFixes,
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
    },
    coordinates,
    trackData,
    date,
    duration_s,
    distance_km: totalDistKm,
  };
}
