import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { FileStorageS3Config } from '../file-storage-s3.config';
import { S3FileStorageProvider } from './s3-file-storage.provider';

describe('S3FileStorageProvider', () => {
  const config: FileStorageS3Config = {
    region: 'auto',
    bucket: 'billing-files',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    forcePathStyle: true,
    endpoint: 'https://example.r2.cloudflarestorage.com',
    keyPrefix: 'prod',
  };

  let send: jest.Mock;
  let provider: S3FileStorageProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, FILE_STORAGE_ROOT: '/data' };
    send = jest.fn();
    const client = { send } as unknown as S3Client;

    provider = S3FileStorageProvider.createForTests(client, config);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns s3 provider type', () => {
    expect(provider.getType()).toBe('s3');
  });

  it('writes with prefixed scoped object key', async () => {
    send.mockResolvedValue({});

    await provider.writeFile('/data/customer/invoices', 'sub-1/inv-1.pdf', Buffer.from('pdf'));

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutObjectCommand;

    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'billing-files',
      Key: 'prod/customer/invoices/sub-1/inv-1.pdf',
      ContentType: 'application/octet-stream',
    });
    expect(Buffer.isBuffer(command.input.Body)).toBe(true);
  });

  it('reads object body as Buffer', async () => {
    send.mockResolvedValue({
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3]),
      },
    });

    const buffer = await provider.readFile('/data/customer/invoices', 'a.pdf');

    expect(buffer.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Key).toBe('prod/customer/invoices/a.pdf');
  });

  it('fileExists returns false on NotFound', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }),
    );

    await expect(provider.fileExists('/data/customer/invoices', 'missing.pdf')).resolves.toBe(false);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('fileExists returns true when head succeeds', async () => {
    send.mockResolvedValue({});

    await expect(provider.fileExists('/data/customer/invoices', 'a.pdf')).resolves.toBe(true);
  });

  it('fileExists rethrows unexpected errors', async () => {
    send.mockRejectedValue(new Error('network down'));

    await expect(provider.fileExists('/data/customer/invoices', 'a.pdf')).rejects.toThrow('network down');
  });
});
