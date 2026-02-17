import IGCParser from "igc-parser";
import { solver, scoringRules as scoring } from "igc-xc-score";
import { Point } from "igc-xc-score/src/foundation.js";
import { analyze } from "./analyze_flight.js";

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

async function getTimezone(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lon}`
    );
    const data = (await res.json()) as { timeZone: string };
    return data.timeZone;
  } catch {
    const offset = Math.round(lon / 15);
    return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
  }
}

export async function scoreIgc(igcContent: string): Promise<ScoreResult> {
  const flight = IGCParser.parse(igcContent, { lenient: true }) as any;

  const lat = flight.fixes[0].latitude;
  const lon = flight.fixes[0].longitude;
  const timeZone = await getTimezone(lat, lon);

  // Filter fixes to 8am - 5pm local time
  flight.fixes = flight.fixes.filter((fix: any) => {
    const localHour = parseInt(
      new Date(fix.timestamp).toLocaleString("en-US", {
        timeZone,
        hour: "numeric",
        hour12: false,
      })
    );
    return localHour >= 8 && localHour < 17;
  });

  // XC scoring - triangle rules only
  const triangleScoringRules = (scoring as any).XContest
    .filter((r: any) => r.code === "tri" || r.code === "fai")
    .map((r: any) => ({
      ...r,
      closingDistanceRelative: 0.8,
      closingDistanceFree: 0,
      closingDistanceFixed: 0,
    }));

  const gen = solver(flight, triangleScoringRules);
  let best = gen.next().value;
  let cycles = 0;
  while (!best.optimal && cycles < 100) {
    const next = gen.next().value;
    if (next) best = next;
    else break;
    cycles++;
  }

  // Analyze for ground detection
  analyze(flight, { analyze: true });

  const triangleDist = best.scoreInfo?.distance ?? 0;
  const penalty = best.scoreInfo?.penalty ?? 0;
  const closed = triangleDist * 0.2 > penalty;

  // Ground distance from onGround fixes
  let groundDist = 0;
  const filterWindow = 5;
  for (
    let i = filterWindow;
    i < flight.fixes.length - filterWindow;
    i += filterWindow
  ) {
    if (flight.fixes[i].onGround) {
      const dist = new Point(flight.fixes, i - filterWindow).distanceEarth(
        new Point(flight.fixes, i)
      );
      groundDist += dist;
    }
  }

  // Score calculation
  let score = 0;
  score += triangleDist;
  score -= penalty * 2;
  score += groundDist;
  score *= best.opt.scoring.multiplier;

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
    score,
    breakdown: {
      triangle_km: triangleDist,
      penalty_km: penalty,
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
