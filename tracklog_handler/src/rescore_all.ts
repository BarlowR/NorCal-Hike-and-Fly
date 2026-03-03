/**
 * Re-scores every track in processed/ with the current algorithm and
 * rebuilds all scores/users/<user>.json files and scores/leaderboard.json
 * from scratch.
 *
 * Usage:
 *   npm run build && npm run rescore
 *
 * Add --dry-run to score locally without writing to R2.
 */

import { listObjects, getObject, putObject } from "./r2.js";
import { scoreIgc, type ScoreResult } from "./score.js";

const DRY_RUN = process.argv.includes("--dry-run");

interface FlightEntry {
  id: string;
  date: string;
  score: number;
  breakdown: ScoreResult["breakdown"];
  distance_km: number;
  duration_s: number;
  track_file: string;
}

interface UserData {
  user_id: string;
  display_name: string;
  category: string;
  stats: {
    total_score: number;
    total_km: number;
    total_flights: number;
    avg_score: number;
    best_score: number;
  };
  flights: FlightEntry[];
}

interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  category: string;
  total_score: number;
  total_km: number;
  total_flights: number;
  best_score: number;
  last_flight: string;
}

function computeStats(flights: FlightEntry[]): UserData["stats"] {
  const scores = flights.map((f) => f.score);
  const top2 = [...scores].sort((a, b) => b - a).slice(0, 2);
  return {
    total_score: top2.reduce((a, b) => a + b, 0),
    total_km: flights.reduce((a, f) => a + f.breakdown.hiking_km, 0),
    total_flights: flights.length,
    avg_score: flights.length > 0 ? scores.reduce((a, b) => a + b, 0) / flights.length : 0,
    best_score: flights.length > 0 ? Math.max(...scores) : 0,
  };
}

async function main() {
  if (DRY_RUN) console.log("DRY RUN — results will not be written to R2.\n");

  // Load users.json for display names and categories.
  // Keys are normalised to lowercase so that "Merlin-rob" matches a processed/merlin-rob/ path.
  type UserCfg = { passphrase: string; display_name?: string; category?: string };
  let usersConfig: Record<string, UserCfg> = {};
  try {
    const raw: Record<string, UserCfg> = JSON.parse(await getObject("users.json"));
    for (const [k, v] of Object.entries(raw)) {
      usersConfig[k.toLowerCase()] = { ...v, display_name: v.display_name ?? k };
    }
    console.log(`Loaded users.json (${Object.keys(usersConfig).length} users)`);
  } catch (err) {
    console.warn("Could not load users.json:", err);
  }

  // List all tracks in processed/
  console.log("\nListing processed tracks...");
  const allKeys = await listObjects("processed/");
  const trackKeys = allKeys.filter((k) => {
    const ext = k.split(".").pop()?.toLowerCase();
    return ext === "igc" || ext === "gpx";
  });

  if (trackKeys.length === 0) {
    console.log("No tracks found in processed/");
    return;
  }
  console.log(`Found ${trackKeys.length} track(s)\n`);

  // Re-score every track, grouped by user
  const userFlights = new Map<string, FlightEntry[]>();
  let ok = 0, failed = 0;

  for (const key of trackKeys) {
    const parts = key.split("/");
    if (parts.length < 3) {
      console.warn(`  Unexpected key format, skipping: ${key}`);
      continue;
    }
    const userId = parts[1];
    const filename = parts.slice(2).join("/");
    const flightId = filename.replace(/\.(igc|gpx)$/i, "");

    process.stdout.write(`  ${key} ... `);
    try {
      const content = await getObject(key);
      const result = await scoreIgc(content);

      const trackKey = `scores/tracks/${userId}/${flightId}.json`;
      if (!DRY_RUN) {
        await putObject(
          trackKey,
          JSON.stringify({
            coordinates: result.coordinates,
            trackData: result.trackData,
            start: result.date,
          })
        );
      }

      const entry: FlightEntry = {
        id: flightId,
        date: result.date,
        score: result.score,
        breakdown: result.breakdown,
        distance_km: result.distance_km,
        duration_s: result.duration_s,
        track_file: trackKey,
      };

      if (!userFlights.has(userId)) userFlights.set(userId, []);
      userFlights.get(userId)!.push(entry);

      console.log(`score=${result.score.toFixed(2)}`);
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err}`);
      failed++;
    }
  }

  console.log(`\nScored: ${ok} ok, ${failed} failed\n`);

  // Write updated user files
  console.log("Writing user files...");
  const rankings: LeaderboardEntry[] = [];

  for (const [userId, flights] of userFlights) {
    flights.sort((a, b) => b.date.localeCompare(a.date));

    const cfg = usersConfig[userId.toLowerCase()] ?? {};
    const userData: UserData = {
      user_id: userId,
      display_name: cfg.display_name ?? userId,
      category: cfg.category ?? "",
      stats: computeStats(flights),
      flights,
    };

    console.log(
      `  ${userId}: ${flights.length} flight(s), total_score=${userData.stats.total_score.toFixed(2)}`
    );

    if (!DRY_RUN) {
      await putObject(`scores/users/${userId}.json`, JSON.stringify(userData, null, 2));
    }

    rankings.push({
      user_id: userId,
      display_name: userData.display_name,
      category: userData.category,
      total_score: userData.stats.total_score,
      total_km: userData.stats.total_km,
      total_flights: userData.stats.total_flights,
      best_score: userData.stats.best_score,
      last_flight: flights.length > 0 ? flights[0].date : "",
    });
  }

  // Write leaderboard
  rankings.sort((a, b) => b.total_score - a.total_score);
  const leaderboard = { updated_at: new Date().toISOString(), rankings };

  console.log(`\nLeaderboard: ${rankings.length} user(s)`);
  if (!DRY_RUN) {
    await putObject("scores/leaderboard.json", JSON.stringify(leaderboard, null, 2));
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] No changes written to R2.");
  } else {
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error("Rescore failed:", err);
  process.exit(1);
});
