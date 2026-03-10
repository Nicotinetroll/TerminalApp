import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env['AWS_S3_REGION'] || 'eu-north-1';
const BUCKET = process.env['AWS_S3_BUCKET'] || 'mynig-transfers';

const client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env['AWS_ACCESS_KEY_ID'] || '',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
  },
});

export function s3Key(transferId: string): string {
  return `transfers/${transferId}.zip`;
}

/** Generate a presigned PUT URL for direct browser upload to S3 */
export async function getPresignedUploadUrl(transferId: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key(transferId),
  });
  // Don't sign ContentType — avoids header mismatch 400s from S3
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

/** Generate a presigned GET URL for download */
export async function getPresignedDownloadUrl(transferId: string, filename: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key(transferId),
    ResponseContentDisposition: `attachment; filename="${filename}"`,
    ResponseContentType: 'application/zip',
  });
  // URL valid for 6 hours
  return getSignedUrl(client, command, { expiresIn: 6 * 3600 });
}

/** Check if an S3 object exists and return its size */
export async function getObjectSize(transferId: string): Promise<number | null> {
  try {
    const resp = await client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: s3Key(transferId),
    }));
    return resp.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** Delete an object from S3 */
export async function deleteObject(transferId: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: s3Key(transferId),
    }));
  } catch {
    // best effort — object may already be gone
  }
}
