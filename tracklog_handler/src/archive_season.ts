/**
 * Pre-archive check for a finished season. Read-only: never copies, moves,
 * overwrites, or deletes anything.
 *
 * Seasons live under their own prefix in R2 (<season>/processed, <season>/scores),
 * so "archiving" a season means verifying that:
 *   - no unprocessed tracks remain in incoming/
 *   - <season>/scores/leaderboard.json exists
 * and reporting object counts. Once this passes, the season is ready to be
 * added to the site's Past Seasons page.
 *
 * Usage:
 *   npm run build && npm run archive-season -- --season=2026
 *   (--dry-run is accepted for symmetry; the tool is always read-only)
 */

import { listObjects, getObject } from "./r2.js";

const season = process.argv.find((a) => a.startsWith("--season="))?.split("=")[1] ?? process.env.SEASON;

async function main() {
  if (!season) throw new Error("Specify the season: npm run archive-season -- --season=2026");
  console.log(`Checking season ${season} (read-only)\n`);
  let problems = 0;

  const incoming = (await listObjects("incoming/")).filter((k) => !k.endsWith("/"));
  console.log(`incoming/: ${incoming.length} pending track(s)`);
  if (incoming.length > 0) {
    problems++;
    incoming.forEach((k) => console.log(`  ${k}`));
    console.log("  -> process these (npm run process) before archiving.");
  }

  for (const sub of ["processed", "scores", "deleted"]) {
    const keys = (await listObjects(`${season}/${sub}/`)).filter((k) => !k.endsWith("/"));
    console.log(`${season}/${sub}/: ${keys.length} object(s)`);
  }

  try {
    const lb = JSON.parse(await getObject(`${season}/scores/leaderboard.json`));
    const n = Array.isArray(lb) ? lb.length : Object.keys(lb).length;
    console.log(`${season}/scores/leaderboard.json: present (${n} top-level entries)`);
  } catch (err) {
    problems++;
    console.log(`${season}/scores/leaderboard.json: MISSING or unreadable (${err})`);
  }

  console.log(problems === 0 ? `\nSeason ${season} is ready to archive.` : `\n${problems} problem(s) found.`);
  if (problems > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Archive check failed:", err);
  process.exit(1);
});
