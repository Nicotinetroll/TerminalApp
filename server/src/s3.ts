import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

const REGION = process.env['AWS_S3_REGION'] || 'eu-north-1';
const BUCKET = process.env['AWS_S3_BUCKET'] || 'mynig-transfers';

const client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env['AWS_ACCESS_KEY_ID'] || '',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] || '',
  },
});

export function s3Key(transferId: string, raw = false): string {
  return raw ? `transfers/${transferId}` : `transfers/${transferId}.zip`;
}

/** Generate a presigned PUT URL for direct browser upload to S3 */
export async function getPresignedUploadUrl(transferId: string, raw = false, contentType?: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key(transferId, raw),
    ...(contentType ? { ContentType: contentType } : {}),
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

/** Sanitize filename for Content-Disposition header (RFC 5987) */
function safeDisposition(filename: string): string {
  const safe = filename.replace(/["\\\r\n]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

/** Generate a presigned GET URL for download */
export async function getPresignedDownloadUrl(transferId: string, filename: string, raw = false, contentType = 'application/zip'): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key(transferId, raw),
    ResponseContentDisposition: safeDisposition(filename),
    ResponseContentType: contentType,
  });
  // URL valid for 6 hours
  return getSignedUrl(client, command, { expiresIn: 6 * 3600 });
}

/** Check if an S3 object exists and return its size */
export async function getObjectSize(transferId: string, raw = false): Promise<number | null> {
  try {
    const resp = await client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: s3Key(transferId, raw),
    }));
    return resp.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** Delete an object from S3 */
export async function deleteObject(transferId: string, raw = false): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: s3Key(transferId, raw),
    }));
  } catch {
    // best effort — object may already be gone
  }
}

// ── Cloud Storage (S3-backed file storage) ──

export function cloudS3Key(userId: number, fileId: string): string {
  return `cloud/${userId}/${fileId}`;
}

/** Generate a presigned PUT URL for cloud file upload */
export async function getCloudUploadUrl(userId: number, fileId: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: cloudS3Key(userId, fileId),
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

/** Generate a presigned GET URL for cloud file download */
export async function getCloudDownloadUrl(userId: number, fileId: string, filename: string, contentType: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: cloudS3Key(userId, fileId),
    ResponseContentDisposition: safeDisposition(filename),
    ResponseContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 6 * 3600 });
}

/** Check if a cloud S3 object exists and return its size */
export async function getCloudObjectSize(userId: number, fileId: string): Promise<number | null> {
  try {
    const resp = await client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: cloudS3Key(userId, fileId),
    }));
    return resp.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** Delete a cloud object from S3 */
export async function deleteCloudObject(userId: number, fileId: string): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: cloudS3Key(userId, fileId),
    }));
  } catch {
    // best effort
  }
}

/** Delete all cloud objects for a user (batch) */
export async function deleteAllCloudObjects(userId: number, fileIds: string[]): Promise<void> {
  for (const fileId of fileIds) {
    await deleteCloudObject(userId, fileId);
  }
}

/** Stream a cloud file from S3 (returns Node.js Readable) */
export async function getCloudObject(userId: number, fileId: string): Promise<Readable> {
  const resp = await client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: cloudS3Key(userId, fileId),
  }));
  if (!resp.Body) throw new Error('S3 returned no body');
  return resp.Body as unknown as Readable;
}

/** Upload a buffer directly to S3 as a cloud file */
export async function uploadCloudBuffer(userId: number, fileId: string, buffer: Buffer, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: cloudS3Key(userId, fileId),
    Body: buffer,
    ContentType: contentType,
  }));
}

// ── Mail Attachments (S3-backed) ──

export function mailAttS3Key(userId: number, attachmentId: number): string {
  return `mail/${userId}/${attachmentId}`;
}

/** Upload a mail attachment buffer directly to S3 (server-side, not presigned) */
export async function uploadMailAttachment(userId: number, attachmentId: number, buffer: Buffer, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: mailAttS3Key(userId, attachmentId),
    Body: buffer,
    ContentType: contentType,
  }));
}

/** Generate a presigned GET URL for downloading a mail attachment */
export async function getMailAttDownloadUrl(userId: number, attachmentId: number, filename: string, contentType: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: mailAttS3Key(userId, attachmentId),
    ResponseContentDisposition: safeDisposition(filename),
    ResponseContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 6 * 3600 });
}

/** Delete a mail attachment from S3 */
export async function deleteMailAttachment(userId: number, attachmentId: number): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: mailAttS3Key(userId, attachmentId),
    }));
  } catch {
    // best effort
  }
}
