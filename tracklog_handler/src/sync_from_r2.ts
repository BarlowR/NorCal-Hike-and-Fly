/**
 * Downloads processed/ tracks and users.json from production R2 into a local
 * directory so rescore_all can be run locally without touching production.
 *
 * Usage:
 *   npm run build && npm run sync-local
 *
 * This reads production credentials from .env and writes files into the
 * directory specified by LOCAL_DATA_DIR in .env.local.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { readFileSync } from "fs";

function loadEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  } catch { /* file missing is fine */ }
  return env;
}

const prod = loadEnv(".env");
const local = loadEnv(".env.local");

const localDir = local.LOCAL_DATA_DIR;
if (!localDir) {
  console.error("LOCAL_DATA_DIR not set in .env.local");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${prod.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: prod.R2_ACCESS_KEY_ID,
    secretAccessKey: prod.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = prod.R2_BUCKET_NAME;

async function download(key: string) {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body!.transformToString();
  const dest = join(localDir, key);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body, "utf8");
}

async function main() {
  console.log(`Syncing production R2 → ${localDir}\n`);

  // users.json
  process.stdout.write("  users.json ... ");
  try {
    await download("users.json");
    console.log("ok");
  } catch (e) {
    console.log(`SKIP (${e})`);
  }

  // processed/ tracks
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "processed/", ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);

  const trackKeys = keys.filter(k => /\.(igc|gpx)$/i.test(k));
  console.log(`Found ${trackKeys.length} track(s) in processed/\n`);

  let ok = 0, failed = 0;
  for (const key of trackKeys) {
    process.stdout.write(`  ${key} ... `);
    try {
      await download(key);
      console.log("ok");
      ok++;
    } catch (e) {
      console.log(`FAILED: ${e}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} downloaded, ${failed} failed.`);
  console.log(`\nNow run:  npm run rescore:local`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
