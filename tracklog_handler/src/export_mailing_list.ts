/**
 * Prints the mailing list (one email per line) to stdout.
 * Usage: npm run build && npm run -s export-mailing-list > emails.txt
 */

import { listObjects, getObject } from "./r2.js";

async function main() {
  const emails: string[] = [];
  for (const key of await listObjects("mailing_list/")) {
    if (!key.endsWith(".json")) continue;
    emails.push(JSON.parse(await getObject(key)).email);
  }
  emails.sort();
  console.log(emails.join("\n"));
  console.error(`${emails.length} subscriber(s)`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
