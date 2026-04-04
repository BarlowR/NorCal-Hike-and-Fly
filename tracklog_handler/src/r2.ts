import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";

// When LOCAL_DATA_DIR is set, all operations use the local filesystem instead
// of R2. Useful for staging rescores without touching production.
const localDir = process.env.LOCAL_DATA_DIR;

// --- Local filesystem backend ---

function localPath(key: string): string {
  return join(localDir!, key);
}

function localListObjects(prefix: string): string[] {
  const base = join(localDir!, prefix);
  if (!existsSync(base)) return [];
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        // Return key relative to localDir
        results.push(full.slice(localDir!.length + 1));
      }
    }
  }
  walk(base);
  return results;
}

function localGetObject(key: string): string {
  return readFileSync(localPath(key), "utf8");
}

function localPutObject(key: string, body: string): void {
  const p = localPath(key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, "utf8");
}

function localMoveObject(from: string, to: string): void {
  const src = localPath(from);
  const dst = localPath(to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  unlinkSync(src);
}

function localDeleteObject(key: string): void {
  unlinkSync(localPath(key));
}

// --- R2 backend ---

const accountId = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET_NAME!;

const client = localDir ? null : new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// --- Public API ---

export async function listObjects(prefix: string): Promise<string[]> {
  if (localDir) return localListObjects(prefix);

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client!.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    if (res.Contents) {
      for (const obj of res.Contents) {
        if (obj.Key) keys.push(obj.Key);
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

export async function getObject(key: string): Promise<string> {
  if (localDir) return localGetObject(key);

  const res = await client!.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return await res.Body!.transformToString();
}

export async function putObject(
  key: string,
  body: string,
  contentType = "application/json"
): Promise<void> {
  if (localDir) return localPutObject(key, body);

  await client!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function moveObject(from: string, to: string): Promise<void> {
  if (localDir) return localMoveObject(from, to);

  await client!.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${from}`,
      Key: to,
    })
  );
  await client!.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: from })
  );
}

export async function deleteObject(key: string): Promise<void> {
  if (localDir) return localDeleteObject(key);

  await client!.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
}
