/**
 * Downloads the entire R2 bucket to a local directory.
 *
 * Usage:
 *   npm run build && npm run backup
 *   npm run backup -- ./my-backup-dir   # custom output directory
 *
 * Default output: ./backup-<YYYY-MM-DD>
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const accountId = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET_NAME!;

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const today = new Date().toISOString().slice(0, 10);
const outDir = process.argv[2] ?? `./backup-${today}`;

async function listAll(): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function main() {
  console.log(`Backing up bucket "${bucket}" → ${outDir}\n`);

  const keys = await listAll();
  console.log(`Found ${keys.length} object(s)\n`);

  let ok = 0, failed = 0;

  for (const key of keys) {
    process.stdout.write(`  ${key} ... `);
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      const dest = join(outDir, key);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      console.log(`ok (${bytes.length} bytes)`);
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok}/${keys.length} downloaded${failed > 0 ? `, ${failed} failed` : ""}.`);
  console.log(`Backup saved to: ${outDir}`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
