/**
 * Adds trackData.display (see display_track.ts) to existing track JSON files
 * so the flights page can draw them without downloading and parsing the raw
 * IGC/GPX. Scores and flight segments are left untouched: this only derives
 * the display fixes from the stored flightSegments and the source file.
 *
 * Usage (dry run by default; reports sizes, writes nothing):
 *   npm run build && node --env-file=.env dist/backfill_display.js --season=2026
 *   npm run build && node --env-file=.env dist/backfill_display.js --season=prologue
 * Against the local copy:
 *   node --env-file=.env --env-file=../.env.local dist/backfill_display.js --season=2026
 *
 * Flags:
 *   --write   actually write the updated track JSON files
 *   --force   recompute display even for files that already have one
 */

import { listObjects, getObject, putObject } from "./r2.js";
import { igcTimeZone, getTimezone } from "./hf_scoring.js";
import { parseFixes } from "./parseFixes.js";
import { displayFixesFromSource, encodeDisplayTrack } from "./display_track.js";

const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");
const seasonArg = process.argv.find(a => a.startsWith("--season="));
const SEASON = seasonArg !== undefined ? seasonArg.slice("--season=".length) : (process.env.SEASON ?? "2026");
const S = SEASON ? `${SEASON}/` : "";

/**
 * Same timezone resolution as scoreTrack() in hf_scoring.ts, except that a
 * failed timeapi.io lookup is retried and then treated as an error.
 * getTimezone() silently falls back to a longitude-based Etc/GMT offset, which
 * ignores DST (an hour off in summer) and would bake a wrong contest-window
 * cut into the stored display track. timeapi.io rate-limits bursts, so lookups
 * are also memoised per rounded location and spaced out.
 */
const tzMemo = new Map<string, string>();
async function resolveTimeZone(content: string): Promise<string> {
  const isGpx = content.trimStart().startsWith("<");
  const tz = !isGpx ? igcTimeZone(content) : null;
  if (tz) return tz;
  const fixes = parseFixes(content);
  const valid = fixes.find(f => f.latitude !== 0 || f.longitude !== 0) ?? fixes[0];
  const memoKey = `${valid.latitude.toFixed(2)},${valid.longitude.toFixed(2)}`;
  const memo = tzMemo.get(memoKey);
  if (memo) return memo;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    const result = await getTimezone(valid.latitude, valid.longitude);
    if (result && !result.startsWith("Etc/GMT")) {
      tzMemo.set(memoKey, result);
      return result;
    }
  }
  throw new Error("timezone lookup failed (timeapi.io unavailable); not writing a guessed timezone");
}

async function main() {
  console.log(`${WRITE ? "WRITING" : "DRY RUN (pass --write to save)"} — season prefix "${S}"\n`);

  const userKeys = (await listObjects(`${S}scores/users/`)).filter(k => k.endsWith(".json"));
  let updated = 0, skipped = 0, failed = 0, srcBytes = 0, oldBytes = 0, newBytes = 0;

  for (const userKey of userKeys) {
    const user = JSON.parse(await getObject(userKey));
    for (const flight of user.flights ?? []) {
      const { track_file, source_key } = flight;
      if (!track_file || !source_key) { skipped++; continue; }
      try {
        const raw = await getObject(track_file);
        const track = JSON.parse(raw);
        const td = track.trackData;
        if (!td?.flightSegments) {
          console.log(`  skip (no flightSegments, older format): ${track_file}`);
          skipped++;
          continue;
        }
        if (td.display && !FORCE) { skipped++; continue; }

        const content = await getObject(source_key);
        const tz = await resolveTimeZone(content);
        const display = encodeDisplayTrack(displayFixesFromSource(content, tz, td.flightSegments));
        const out = JSON.stringify({ ...track, trackData: { ...td, display } });

        srcBytes += Buffer.byteLength(content);
        oldBytes += Buffer.byteLength(raw);
        newBytes += Buffer.byteLength(out);
        console.log(
          `  ${track_file}: ${display.lat.length} fixes, tz=${tz}, ` +
          `source ${(Buffer.byteLength(content) / 1e6).toFixed(2)} MB -> track JSON ${(Buffer.byteLength(out) / 1e3).toFixed(0)} KB`
        );
        if (WRITE) await putObject(track_file, out);
        updated++;
      } catch (err) {
        console.log(`  FAILED ${track_file}: ${err}`);
        failed++;
      }
    }
  }

  console.log(
    `\n${WRITE ? "Updated" : "Would update"} ${updated}, skipped ${skipped}, failed ${failed}. ` +
    `Per-view download for these: ${((srcBytes + oldBytes) / 1e6).toFixed(1)} MB (source + JSON) -> ${(newBytes / 1e6).toFixed(1)} MB (JSON only).`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
