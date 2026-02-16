import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

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

export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
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
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  return await res.Body!.transformToString();
}

export async function putObject(
  key: string,
  body: string,
  contentType = "application/json"
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function moveObject(from: string, to: string): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${from}`,
      Key: to,
    })
  );
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: from })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
}
