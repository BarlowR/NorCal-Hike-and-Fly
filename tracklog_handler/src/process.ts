import { listObjects, getObject, putObject, moveObject } from "./r2.js";
import { scoreIgc, type ScoreResult } from "./score.js";

interface FlightEntry {
  id: string;
  date: string;
  score: number;
  breakdown: ScoreResult["breakdown"];
  distance_km: number;
  elevation_gain_m: number;
  duration_s: number;
  track_file: string;
}

interface UserData {
  user_id: string;
  display_name: string;
  stats: {
    total_score: number;
    total_km: number;
    total_flights: number;
    total_elevation_m: number;
    avg_score: number;
    best_score: number;
  };
  flights: FlightEntry[];
}

interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  total_score: number;
  total_km: number;
  total_flights: number;
  best_score: number;
  last_flight: string;
}

interface Leaderboard {
  updated_at: string;
  rankings: LeaderboardEntry[];
}

function computeStats(flights: FlightEntry[]): UserData["stats"] {
  const scores = flights.map((f) => f.score);
  return {
    total_score: scores.reduce((a, b) => a + b, 0),
    total_km: flights.reduce((a, f) => a + f.distance_km, 0),
    total_flights: flights.length,
    total_elevation_m: flights.reduce((a, f) => a + f.elevation_gain_m, 0),
    avg_score: flights.length > 0 ? scores.reduce((a, b) => a + b, 0) / flights.length : 0,
    best_score: flights.length > 0 ? Math.max(...scores) : 0,
  };
}

async function getExistingUserData(userId: string): Promise<UserData> {
  try {
    const content = await getObject(`scores/users/${userId}.json`);
    return JSON.parse(content);
  } catch {
    return {
      user_id: userId,
      display_name: userId,
      stats: {
        total_score: 0,
        total_km: 0,
        total_flights: 0,
        total_elevation_m: 0,
        avg_score: 0,
        best_score: 0,
      },
      flights: [],
    };
  }
}

async function main() {
  console.log("Listing incoming files...");
  const allKeys = await listObjects("incoming/");
  const igcKeys = allKeys.filter((k) => k.toLowerCase().endsWith(".igc"));

  if (igcKeys.length === 0) {
    console.log("No new IGC files to process.");
    return;
  }

  console.log(`Found ${igcKeys.length} IGC file(s) to process.`);

  // Track which users got new flights
  const userNewFlights = new Map<string, FlightEntry[]>();

  for (const key of igcKeys) {
    try {
      console.log(`Processing: ${key}`);

      // Extract userId and flightId from key: incoming/<user_id>/<timestamp>-<filename>.igc
      const parts = key.split("/");
      if (parts.length < 3) {
        console.error(`Unexpected key format: ${key}`);
        continue;
      }
      const userId = parts[1];
      const filename = parts.slice(2).join("/");
      const flightId = filename.replace(/\.igc$/i, "");

      // Download and score
      const content = await getObject(key);
      const result = await scoreIgc(content);

      // Write track file
      const trackKey = `scores/tracks/${userId}/${flightId}.json`;
      await putObject(
        trackKey,
        JSON.stringify({
          coordinates: result.coordinates,
          start: result.date,
        })
      );

      // Build flight entry
      const entry: FlightEntry = {
        id: flightId,
        date: result.date,
        score: result.score,
        breakdown: result.breakdown,
        distance_km: result.distance_km,
        elevation_gain_m: result.elevation_gain_m,
        duration_s: result.duration_s,
        track_file: trackKey,
      };

      if (!userNewFlights.has(userId)) {
        userNewFlights.set(userId, []);
      }
      userNewFlights.get(userId)!.push(entry);

      // Move to processed
      const processedKey = key.replace("incoming/", "processed/");
      await moveObject(key, processedKey);

      console.log(`  Score: ${result.score.toFixed(2)}, moved to ${processedKey}`);
    } catch (err) {
      console.error(`Failed to process ${key}:`, err);
      // Leave in incoming/ for retry
    }
  }

  // Update user files
  for (const [userId, newFlights] of userNewFlights) {
    try {
      console.log(`Updating user data for: ${userId}`);
      const userData = await getExistingUserData(userId);

      // Append new flights (avoid duplicates by id)
      const existingIds = new Set(userData.flights.map((f) => f.id));
      for (const flight of newFlights) {
        if (!existingIds.has(flight.id)) {
          userData.flights.push(flight);
        }
      }

      // Sort flights by date descending
      userData.flights.sort((a, b) => b.date.localeCompare(a.date));

      // Recompute stats
      userData.stats = computeStats(userData.flights);

      await putObject(
        `scores/users/${userId}.json`,
        JSON.stringify(userData, null, 2)
      );
    } catch (err) {
      console.error(`Failed to update user data for ${userId}:`, err);
    }
  }

  // Build leaderboard
  console.log("Building leaderboard...");
  try {
    const userKeys = await listObjects("scores/users/");
    const jsonKeys = userKeys.filter((k) => k.endsWith(".json"));

    const rankings: LeaderboardEntry[] = [];

    for (const userKey of jsonKeys) {
      try {
        const userData: UserData = JSON.parse(await getObject(userKey));
        rankings.push({
          user_id: userData.user_id,
          display_name: userData.display_name,
          total_score: userData.stats.total_score,
          total_km: userData.stats.total_km,
          total_flights: userData.stats.total_flights,
          best_score: userData.stats.best_score,
          last_flight:
            userData.flights.length > 0 ? userData.flights[0].date : "",
        });
      } catch (err) {
        console.error(`Failed to read user file ${userKey}:`, err);
      }
    }

    rankings.sort((a, b) => b.total_score - a.total_score);

    const leaderboard: Leaderboard = {
      updated_at: new Date().toISOString(),
      rankings,
    };

    await putObject(
      "scores/leaderboard.json",
      JSON.stringify(leaderboard, null, 2)
    );
    console.log(
      `Leaderboard updated with ${rankings.length} user(s).`
    );
  } catch (err) {
    console.error("Failed to build leaderboard:", err);
    throw err;
  }

  console.log("Processing complete.");
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
