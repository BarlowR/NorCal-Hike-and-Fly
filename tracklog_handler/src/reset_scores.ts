/**
 * Deletes all scored data from R2:
 *   scores/leaderboard.json
 *   scores/users/<user>.json
 *   scores/tracks/<user>/<flight>.json
 *
 * Uploaded tracklogs in incoming/ and processed/ are NOT touched.
 *
 * Usage:
 *   npm run build && node dist/reset_scores.js
 *
 * Add --dry-run to preview without deleting:
 *   node dist/reset_scores.js --dry-run
 */

import { listObjects, deleteObject, putObject } from "./r2.js";

const EMPTY_LEADERBOARD = JSON.stringify({ updated_at: new Date().toISOString(), rankings: [] }, null, 2);

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (DRY_RUN) console.log("DRY RUN — nothing will be deleted.\n");

  const keys = await listObjects("scores/");
  if (keys.length === 0) {
    console.log("Nothing to delete under scores/");
  }

  console.log(`Found ${keys.length} object(s) to delete:`);
  for (const key of keys) {
    console.log(`  ${DRY_RUN ? "[dry-run] " : ""}${key}`);
    if (!DRY_RUN) await deleteObject(key);
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] scores/leaderboard.json (empty leaderboard)");
    console.log("\nDry run complete.");
  } else {
    await putObject("scores/leaderboard.json", EMPTY_LEADERBOARD);
    console.log("  Created empty scores/leaderboard.json");
    console.log("\nReset complete.");
  }
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
