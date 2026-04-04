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
import { scoreIgc, computeFriendsBonus, FRIENDS_MULTIPLIER, type FlightRef } from "./score.js";
import { type FlightEntry, type UserData, type LeaderboardEntry, computeStats } from "./user_data.js";

const DRY_RUN = process.argv.includes("--dry-run");

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
        elevation_gain_m: result.breakdown.elevation_gain_m,
        track_file: trackKey,
        source_key: key,
        launch_lat: result.launch_lat,
        launch_lon: result.launch_lon,
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

  // Compute friends bonus across all flights
  console.log("Computing friends bonus...");
  const allFlightRefs: FlightRef[] = [];
  for (const [userId, flights] of userFlights) {
    for (const flight of flights) {
      allFlightRefs.push({
        id: `${userId}/${flight.id}`,
        date: flight.date,
        launch_lat: flight.launch_lat,
        launch_lon: flight.launch_lon,
      });
    }
  }
  const qualifying = computeFriendsBonus(allFlightRefs);
  console.log(`  ${qualifying.size} qualifying flight(s)\n`);

  for (const [userId, flights] of userFlights) {
    for (const flight of flights) {
      flight.breakdown.friends_bonus = qualifying.has(`${userId}/${flight.id}`);
      flight.score = flight.breakdown.base_score * (flight.breakdown.friends_bonus ? FRIENDS_MULTIPLIER : 1);
    }
  }

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
      total_elevation_gain_m: userData.stats.total_elevation_gain_m,
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
