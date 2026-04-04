/**
 * Migrates prologue data from the root scores/ and processed/ prefixes
 * to prologue/scores/ and prologue/processed/ in R2.
 *
 * This is a one-time migration for the prologue, which was scored before
 * the per-season directory structure was introduced.
 *
 * Run this BEFORE npm run reset to start the 2026 season.
 *
 * Usage:
 *   npm run build && npm run archive-prologue
 *
 * Add --dry-run to preview without copying:
 *   npm run archive-prologue -- --dry-run
 */

import { listObjects, copyObject } from "./r2.js";

const DRY_RUN = process.argv.includes("--dry-run");
const PREFIXES = ["scores/", "processed/"];
const DEST_PREFIX = "prologue/";

async function main() {
  if (DRY_RUN) console.log("DRY RUN — nothing will be copied.\n");
  console.log(`Migrating prologue data → ${DEST_PREFIX}\n`);

  let total = 0, ok = 0, failed = 0;

  for (const prefix of PREFIXES) {
    const keys = await listObjects(prefix);
    console.log(`\n${prefix}: ${keys.length} object(s)`);

    for (const key of keys) {
      const dest = `${DEST_PREFIX}${key}`;
      process.stdout.write(`  ${key} → ${dest} ... `);
      total++;

      if (DRY_RUN) {
        console.log("[dry-run]");
        ok++;
        continue;
      }

      try {
        await copyObject(key, dest);
        console.log("ok");
        ok++;
      } catch (err) {
        console.log(`FAILED: ${err}`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${ok}/${total} copied${failed > 0 ? `, ${failed} failed` : ""}.`);
  if (!DRY_RUN && failed === 0) {
    console.log("\nNext step: npm run reset  (clears root scores/ for the new season)");
    console.log("Note: root processed/ tracks are NOT deleted — they remain as prologue source files.");
  }
}

main().catch((err) => {
  console.error("Archive failed:", err);
  process.exit(1);
});
