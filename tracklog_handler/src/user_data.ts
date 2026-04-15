import type { ScoreResult } from "./score.js";

export interface FlightEntry {
  id: string;
  date: string;
  score: number;
  breakdown: ScoreResult["breakdown"];
  distance_km: number;
  duration_s: number;
  elevation_gain_m: number;
  track_file: string;
  source_key: string;
  launch_lat: number;
  launch_lon: number;
}

export interface UserData {
  user_id: string;
  display_name: string;
  category: string;
  stats: {
    total_score: number;
    total_km: number;
    total_elevation_gain_m: number;
    total_flights: number;
    avg_score: number;
    best_score: number;
  };
  flights: FlightEntry[];
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  category: string;
  total_score: number;
  total_km: number;
  total_elevation_gain_m: number;
  total_flights: number;
  best_score: number;
  last_flight: string;
}

export function computeStats(flights: FlightEntry[]): UserData["stats"] {
  const scores = flights.map((f) => f.score);
  const top2 = [...scores].sort((a, b) => b - a).slice(0, 4);
  return {
    total_score: top2.reduce((a, b) => a + b, 0),
    total_km: flights.reduce((a, f) => a + f.breakdown.hiking_km, 0),
    total_elevation_gain_m: flights.reduce((a, f) => a + (f.elevation_gain_m ?? 0), 0),
    total_flights: flights.length,
    avg_score: flights.length > 0 ? scores.reduce((a, b) => a + b, 0) / flights.length : 0,
    best_score: flights.length > 0 ? Math.max(...scores) : 0,
  };
}
