import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { PostalWebhookController } from './postal-webhook.controller';

describe('PostalWebhookController', () => {
  const postalLetterService = { handleWebhook: jest.fn() };
  const controller = new PostalWebhookController(postalLetterService as never);
  const request = (rawBody: Buffer | undefined, headers: Record<string, string> = {}) =>
    ({ rawBody, headers, body: {} }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('is public (authenticity is the provider signature)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PostalWebhookController.prototype.handle)).toBe(true);
  });

  it('passes the raw body and headers to the service', async () => {
    const body = Buffer.from('{"data":{}}');

    await expect(controller.handle('pingen', request(body, { signature: 'abc' }))).resolves.toEqual({
      received: true,
    });
    expect(postalLetterService.handleWebhook).toHaveBeenCalledWith('pingen', '{"data":{}}', { signature: 'abc' });
  });

  it('rejects malformed provider names, missing and oversized bodies', async () => {
    await expect(controller.handle('../stripe', request(Buffer.from('{}')))).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.handle('pingen', request(undefined))).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.handle('pingen', request(Buffer.alloc(300 * 1024)))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(postalLetterService.handleWebhook).not.toHaveBeenCalled();
  });

  it('propagates signature failures', async () => {
    postalLetterService.handleWebhook.mockRejectedValueOnce(new UnauthorizedException('Invalid webhook signature'));

    await expect(controller.handle('pingen', request(Buffer.from('{}')))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
