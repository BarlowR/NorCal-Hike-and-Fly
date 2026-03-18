/**
 * Test runner for analyze_flight.js launch/landing detection.
 *
 * Usage:
 *   npm run build && npm test
 *
 * Test cases are JSON files in tests/labeled/ created by label_tool.ipynb.
 * Each case stores manually-chosen launch/landing timestamps for one track.
 * The runner loads the real track file, runs analyze(), and checks whether
 * the detected times are within TOLERANCE_MS of the expected values.
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import IGCParser from "igc-parser";
import { analyze } from "./analyze_flight.js";
import { parseGpx } from "./gpx_parser.js";
import { igcTimeZone, filterByTimeWindow, scoreTrack, COMPETITION_START_HOUR, COMPETITION_END_HOUR } from "./hf_scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

/** Tolerance in milliseconds for launch/landing time comparison. */
const TOLERANCE_MS = 60_000; // 60 seconds

interface ExpectedSegment {
  launch_time: string;
  landing_time: string;
  launch_timestamp_ms: number;
  landing_timestamp_ms: number;
  launch_idx: number;
  landing_idx: number;
}

interface ExpectedScoring {
  expected_score: number;
  score_tolerance: number;
  triangle_code: string;
  closed: boolean;
}

interface TestCase {
  file: string;
  description?: string;
  scoring?: ExpectedScoring;
  expected: ExpectedSegment[];
  algorithm_detected?: unknown[];
}

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

function resolveTrackPath(testCase: TestCase): string {
  const rel = testCase.file;
  if (rel.startsWith("/")) return rel;
  return join(PROJECT_ROOT, rel);
}

function fmt(ms: number): string {
  return new Date(ms).toISOString();
}

function fmtDiff(ms: number): string {
  const s = Math.round(ms / 1000);
  return s === 0 ? "exact" : `${s > 0 ? "+" : ""}${s}s`;
}

async function runTests(): Promise<void> {
  const labeledDir = join(PROJECT_ROOT, "tests", "labeled");

  let jsonFiles: string[];
  try {
    jsonFiles = readdirSync(labeledDir).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`No test-case directory found at: ${labeledDir}`);
    console.error("Create test cases first with label_tool.ipynb.");
    process.exit(1);
  }

  if (jsonFiles.length === 0) {
    console.log("No test cases found. Use label_tool.ipynb to create some.");
    return;
  }

  console.log(`\nRunning ${jsonFiles.length} test case(s)…\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const file of jsonFiles) {
    const casePath = join(labeledDir, file);
    let testCase: TestCase;
    try {
      testCase = JSON.parse(readFileSync(casePath, "utf8"));
    } catch (e) {
      console.log(`SKIP  ${file} — could not parse test case JSON: ${e}`);
      totalSkipped++;
      continue;
    }

    console.log(`Test: ${file}`);
    if (testCase.description) {
      console.log(`  Desc: ${testCase.description}`);
    }

    // Load track file
    const trackPath = resolveTrackPath(testCase);
    let flight: ReturnType<typeof loadFlight>;
    try {
      flight = loadFlight(trackPath);
    } catch (e) {
      console.log(`  SKIP — could not load track: ${trackPath}`);
      console.log(`         ${e}`);
      totalSkipped++;
      continue;
    }

    // Run analyze
    try {
      analyze(flight as any, { analyze: true });
    } catch (e) {
      console.log(`  FAIL — analyze() threw: ${e}`);
      totalFailed++;
      continue;
    }

    const detected = (flight as any).ll as Array<{
      launch: number;
      landing: number;
    }>;
    const filteredFixes = (flight as any).filtered as Array<{
      timestamp: number;
    }>;

    let casePassed = true;

    for (let si = 0; si < testCase.expected.length; si++) {
      const exp = testCase.expected[si];

      if (!detected || detected.length === 0) {
        console.log(`  FAIL — expected ≥1 flight segment, detected 0`);
        casePassed = false;
        break;
      }

      // Find detected segment whose launch is closest in time to expected launch
      let bestMatch: (typeof detected)[0] | null = null;
      let bestScore = Infinity;
      for (const det of detected) {
        const detLaunchTs = filteredFixes[det.launch]?.timestamp;
        const detLandingTs = filteredFixes[det.landing]?.timestamp;
        if (detLaunchTs == null || detLandingTs == null) continue;
        const score =
          Math.abs(detLaunchTs - exp.launch_timestamp_ms) +
          Math.abs(detLandingTs - exp.landing_timestamp_ms);
        if (score < bestScore) {
          bestScore = score;
          bestMatch = det;
        }
      }

      if (!bestMatch) {
        console.log(`  FAIL — segment ${si + 1}: no detected segment to compare`);
        casePassed = false;
        continue;
      }

      const detLaunchTs = filteredFixes[bestMatch.launch].timestamp;
      const detLandingTs = filteredFixes[bestMatch.landing].timestamp;
      const launchDiff = detLaunchTs - exp.launch_timestamp_ms;
      const landingDiff = detLandingTs - exp.landing_timestamp_ms;
      const launchOk = Math.abs(launchDiff) <= TOLERANCE_MS;
      const landingOk = Math.abs(landingDiff) <= TOLERANCE_MS;

      if (launchOk && landingOk) {
        console.log(
          `  ✓ Segment ${si + 1}: launch ${fmtDiff(launchDiff)}, landing ${fmtDiff(landingDiff)}`
        );
      } else {
        casePassed = false;
        console.log(`  ✗ Segment ${si + 1}:`);
        if (!launchOk) {
          console.log(
            `    Launch   expected ${fmt(exp.launch_timestamp_ms)}`
          );
          console.log(
            `             detected ${fmt(detLaunchTs)}  (${fmtDiff(launchDiff)}, tolerance ±${TOLERANCE_MS / 1000}s)`
          );
        }
        if (!landingOk) {
          console.log(
            `    Landing  expected ${fmt(exp.landing_timestamp_ms)}`
          );
          console.log(
            `             detected ${fmt(detLandingTs)}  (${fmtDiff(landingDiff)}, tolerance ±${TOLERANCE_MS / 1000}s)`
          );
        }
      }
    }

    // Run scoring check if test case has a scoring expectation
    if (testCase.scoring) {
      const exp = testCase.scoring;
      let fileContents: string;
      try {
        fileContents = readFileSync(trackPath, "utf8");
      } catch (e) {
        console.log(`  SKIP scoring — could not read track: ${e}`);
        totalSkipped++;
        continue;
      }

      let result: Awaited<ReturnType<typeof scoreTrack>>;
      try {
        result = await scoreTrack(fileContents);
      } catch (e) {
        console.log(`  FAIL scoring — scoreTrack() threw: ${e}`);
        casePassed = false;
        result = undefined;
      }

      if (result) {
        const scoreDiff = Math.abs(result.score - exp.expected_score);
        const scoreOk = scoreDiff <= exp.score_tolerance;
        const codeOk = result.best.opt.scoring.code === exp.triangle_code;
        const closedOk = result.closed === exp.closed;

        if (scoreOk && codeOk && closedOk) {
          console.log(
            `  ✓ Scoring: score=${result.score.toFixed(2)} (expected ${exp.expected_score}, diff ${scoreDiff.toFixed(4)}), code=${result.best.opt.scoring.code}, closed=${result.closed}`
          );
        } else {
          casePassed = false;
          console.log(`  ✗ Scoring:`);
          if (!scoreOk)
            console.log(
              `    Score    expected ${exp.expected_score} ± ${exp.score_tolerance}, got ${result.score.toFixed(4)} (diff ${scoreDiff.toFixed(4)})`
            );
          if (!codeOk)
            console.log(
              `    Code     expected ${exp.triangle_code}, got ${result.best.opt.scoring.code}`
            );
          if (!closedOk)
            console.log(
              `    Closed   expected ${exp.closed}, got ${result.closed}`
            );
        }
      }
    }

    if (casePassed) {
      totalPassed++;
      console.log(`  PASS\n`);
    } else {
      totalFailed++;
      console.log(`  FAIL\n`);
    }
  }

  const total = totalPassed + totalFailed + totalSkipped;
  console.log(
    `Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped — ${total} total`
  );

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
