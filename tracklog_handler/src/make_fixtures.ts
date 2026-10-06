/**
 * Writes column fixtures for the hike-fly-detect package.
 *
 * For each track in tests/tracks/, loads it the same way run_tests.ts does
 * (parser plus the competition time window), runs analyze(), and writes one
 * JSON file with the four columns that go into the analysis plus the detected
 * { launch, landing } index pairs. Gzip the output before committing it to the
 * package: it is read as <stem>.json.gz.
 *
 * Usage:
 *   npm run build && npm run fixtures -- <output dir>
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import IGCParser from "igc-parser";
import { analyze } from "./analyze_flight.js";
import { parseGpx } from "./gpx_parser.js";
import { igcTimeZone, filterByTimeWindow, COMPETITION_START_HOUR, COMPETITION_END_HOUR } from "./hf_scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

function loadFlight(trackPath: string) {
  const content = readFileSync(trackPath, "utf8");
  const isGpx = content.trimStart().startsWith("<");
  const flight = isGpx
    ? parseGpx(content)
    : IGCParser.parse(content, { lenient: true });
  const tz = !isGpx ? igcTimeZone(content) : null;
  if (tz) flight.fixes = filterByTimeWindow(flight.fixes, tz, COMPETITION_START_HOUR, COMPETITION_END_HOUR);
  return flight;
}

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node dist/make_fixtures.js <output dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const tracksDir = join(PROJECT_ROOT, "tests", "tracks");
const trackFiles = readdirSync(tracksDir).filter((f) => /\.(igc|gpx)$/i.test(f)).sort();
for (const file of trackFiles) {
  const trackPath = join(tracksDir, file);
  const stem = file.replace(/\.[^.]+$/, "");
  const flight: any = loadFlight(trackPath);
  try {
    analyze(flight, { analyze: true });
  } catch (e) {
    console.log(`SKIP ${file}: ${e}`);
    continue;
  }
  const fixes = flight.filtered as any[];
  const fixture = {
    source: file,
    timeMs: fixes.map((f) => f.timestamp),
    lat: fixes.map((f) => f.latitude),
    lon: fixes.map((f) => f.longitude),
    // pressureAltitude after analyze() applied the gpsAltitude fallback
    alt: fixes.map((f) => f.pressureAltitude),
    segments: flight.ll,
  };
  const outPath = join(outDir, `${stem}.json`);
  writeFileSync(outPath, JSON.stringify(fixture));
  console.log(`${file}: ${fixes.length} fixes, ${flight.ll.length} segment(s) -> ${outPath}`);
}
