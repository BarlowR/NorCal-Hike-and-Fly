import { listObjects, getObject, putObject, moveObject } from "./r2.js";
import { scoreIgc, computeFriendsBonus, FRIENDS_MULTIPLIER, type ScoreResult, type FlightRef } from "./score.js";

interface FlightEntry {
  id: string;
  date: string;
  score: number;
  breakdown: ScoreResult["breakdown"];
  distance_km: number;
  duration_s: number;
  track_file: string;
  source_key: string;
  launch_lat: number;
  launch_lon: number;
}

interface UserData {
  user_id: string;
  display_name: string;
  category: string;
  stats: {
    total_score: number;
    total_km: number;
    total_elevation_gain: number;
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
  total_elevation_gain: number;
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
  const top2 = [...scores].sort((a, b) => b - a).slice(0, 2);
  return {
    total_score: top2.reduce((a, b) => a + b, 0),
    total_km: flights.reduce((a, f) => a + f.breakdown.hiking_km, 0),
    total_elevation_gain: flights.reduce((a, f) => a + (f.breakdown.hiking_elevation_gain ?? 0), 0),
    total_flights: flights.length,
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
      category: "",
      stats: {
        total_score: 0,
        total_km: 0,
        total_elevation_gain: 0,
        total_flights: 0,
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
  const igcKeys = allKeys.filter((k) => {
    const ext = k.split('.').pop()?.toLowerCase();
    return ext === "igc" || ext === "gpx";
  });

  if (igcKeys.length === 0) {
    console.log("No new tracklog files to process.");
    return;
  }

  console.log(`Found ${igcKeys.length} tracklog file(s) to process.`);

  // Load users.json for category lookup
  let usersConfig: Record<string, { passphrase: string; category?: string }> = {};
  try {
    usersConfig = JSON.parse(await getObject("users.json"));
  } catch (err) {
    console.warn("Could not load users.json for category lookup:", err);
  }

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
      const flightId = filename.replace(/\.(igc|gpx)$/i, "");

      // Download and score
      const content = await getObject(key);
      const result = await scoreIgc(content);

      // Write track file with full data for Flightmap rendering
      const trackKey = `scores/tracks/${userId}/${flightId}.json`;
      await putObject(
        trackKey,
        JSON.stringify({
          trackData: result.trackData,
          start: result.date,
        })
      );

      // Move to processed first so we can store the final key
      const processedKey = key.replace("incoming/", "processed/");
      await moveObject(key, processedKey);

      // Build flight entry
      const entry: FlightEntry = {
        id: flightId,
        date: result.date,
        score: result.score,
        breakdown: result.breakdown,
        distance_km: result.distance_km,
        duration_s: result.duration_s,
        track_file: trackKey,
        source_key: processedKey,
        launch_lat: result.launch_lat,
        launch_lon: result.launch_lon,
      };

      if (!userNewFlights.has(userId)) {
        userNewFlights.set(userId, []);
      }
      userNewFlights.get(userId)!.push(entry);

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

      // Set category from users.json
      if (usersConfig[userId]?.category) {
        userData.category = usersConfig[userId].category;
      }

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

  // Apply friends bonus and build leaderboard
  console.log("Computing friends bonus and building leaderboard...");
  try {
    const userKeys = await listObjects("scores/users/");
    const jsonKeys = userKeys.filter((k) => k.endsWith(".json"));

    // Load all user data
    const allUsers = new Map<string, { key: string; data: UserData }>();
    for (const userKey of jsonKeys) {
      try {
        const userData: UserData = JSON.parse(await getObject(userKey));
        allUsers.set(userData.user_id, { key: userKey, data: userData });
      } catch (err) {
        console.error(`Failed to read user file ${userKey}:`, err);
      }
    }

    // Compute friends bonus across all flights
    const allFlightRefs: FlightRef[] = [];
    for (const [userId, { data }] of allUsers) {
      for (const flight of data.flights) {
        allFlightRefs.push({
          id: `${userId}/${flight.id}`,
          date: flight.date,
          launch_lat: flight.launch_lat ?? 0,
          launch_lon: flight.launch_lon ?? 0,
        });
      }
    }
    const qualifying = computeFriendsBonus(allFlightRefs);
    console.log(`  Friends bonus: ${qualifying.size} qualifying flight(s)`);

    // Apply bonus and re-save any user files that changed
    for (const [userId, { key, data }] of allUsers) {
      let modified = false;
      for (const flight of data.flights) {
        const shouldHave = qualifying.has(`${userId}/${flight.id}`);
        if (shouldHave !== flight.breakdown.friends_bonus) {
          flight.score = flight.breakdown.base_score * (shouldHave ? FRIENDS_MULTIPLIER : 1);
          flight.breakdown.friends_bonus = shouldHave;
          modified = true;
        }
      }
      if (modified) {
        data.stats = computeStats(data.flights);
        await putObject(key, JSON.stringify(data, null, 2));
        console.log(`  Updated friends bonus for ${userId}`);
      }
    }

    // Build leaderboard from updated user data
    const rankings: LeaderboardEntry[] = [];
    for (const [, { data }] of allUsers) {
      rankings.push({
        user_id: data.user_id,
        display_name: data.display_name,
        category: data.category || "",
        total_score: data.stats.total_score,
        total_km: data.stats.total_km,
        total_elevation_gain: data.stats.total_elevation_gain ?? 0,
        total_flights: data.stats.total_flights,
        best_score: data.stats.best_score,
        last_flight: data.flights.length > 0 ? data.flights[0].date : "",
      });
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
    console.log(`Leaderboard updated with ${rankings.length} user(s).`);
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
