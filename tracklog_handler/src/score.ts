import { Point } from "igc-xc-score/src/foundation.js";
import { score } from "./hf_scoring.js";

export interface ScoreBreakdown {
  triangle_km: number;
  penalty_km: number;
  hiking_km: number;
  multiplier: number;
  closed: boolean;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  coordinates: [number, number, number][];
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
  for (let i = 0; i < flight.fixes.length; i += stride) {
    const fix = flight.fixes[i];
    coordinates.push([
      fix.latitude,
      fix.longitude,
      fix.gpsAltitude ?? fix.pressureAltitude ?? 0,
    ]);
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
    }
  }

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
    date,
    duration_s,
    distance_km: totalDistKm,
  };
}
