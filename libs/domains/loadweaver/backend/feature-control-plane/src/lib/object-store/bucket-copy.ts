import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { createFileStorageS3Client } from '@forepath/shared/backend/util-file-storage';

/** S3 client for one Garage generation (path-style, region `garage`). */
export function garageS3Client(endpoint: string, accessKeyId: string, secretAccessKey: string): S3Client {
  return createFileStorageS3Client({
    endpoint,
    region: 'garage',
    bucket: '',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  });
}

export interface CopyProgress {
  continuationToken?: string;
  copied: number;
  done: boolean;
}

/** Registry blobs are content-addressed (the path is the digest): same path and size means same content. */
function immutable(key: string): boolean {
  return key.includes('/blobs/sha256/');
}

/**
 * Copies a bucket from one generation to the next in bounded batches (3.20). Content-addressed blobs that already
 * exist with the same size are skipped; everything else (tag links, indexes, upload state) is compared by ETag, so
 * a moved tag of the same size is copied again. Streams; nothing is buffered whole.
 */
export async function copyBucketBatch(
  source: S3Client,
  target: S3Client,
  bucket: string,
  from: Pick<CopyProgress, 'continuationToken' | 'copied'>,
  options: { maxObjects: number; deadline: number },
): Promise<CopyProgress> {
  let token = from.continuationToken;
  let copied = from.copied;
  let handled = 0;

  for (;;) {
    const page = await source.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: Math.min(100, options.maxObjects),
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;

      const existing = await target.send(new HeadObjectCommand({ Bucket: bucket, Key: object.Key })).catch(() => null);

      if (
        existing &&
        existing.ContentLength === object.Size &&
        (immutable(object.Key) || (!!existing.ETag && existing.ETag === object.ETag))
      )
        continue;

      const body = await source.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));

      await target.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.Key,
          Body: body.Body as NonNullable<typeof body.Body>,
          ContentLength: body.ContentLength,
          ...(body.ContentType ? { ContentType: body.ContentType } : {}),
        }),
      );
      copied++;
    }

    handled += page.Contents?.length ?? 0;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;

    if (!token) return { copied, done: true };

    if (handled >= options.maxObjects || Date.now() >= options.deadline)
      return { continuationToken: token, copied, done: false };
  }
}

/**
 * Removes target objects that no longer exist in the source (deleted tags and manifests), in bounded batches. Runs
 * after the final copy, while the registries are read-only.
 */
export async function sweepBucketBatch(
  source: S3Client,
  target: S3Client,
  bucket: string,
  from: Pick<CopyProgress, 'continuationToken' | 'copied'>,
  options: { maxObjects: number; deadline: number },
): Promise<CopyProgress> {
  let token = from.continuationToken;
  let removed = from.copied;
  let handled = 0;

  for (;;) {
    const page = await target.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: Math.min(100, options.maxObjects),
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;

      const inSource = await source.send(new HeadObjectCommand({ Bucket: bucket, Key: object.Key })).then(
        () => true,
        (error: { $metadata?: { httpStatusCode?: number }; name?: string }) => {
          // Only a definite "not found" deletes; any other error must not remove data.
          if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;

          throw error;
        },
      );

      if (!inSource) {
        await target.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
        removed++;
      }
    }

    handled += page.Contents?.length ?? 0;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;

    if (!token) return { copied: removed, done: true };

    if (handled >= options.maxObjects || Date.now() >= options.deadline)
      return { continuationToken: token, copied: removed, done: false };
  }
}
