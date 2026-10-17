import { createHash } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';

import { JoinTokenEntity } from '../entities/join-token.entity';
import { JoinTokensService, parseJoinToken } from './join-tokens.service';

const TOKEN = `lwj_abcdefghijkl.${'A'.repeat(43)}`;

function tokenEntity(overrides: Partial<JoinTokenEntity> = {}): JoinTokenEntity {
  return Object.assign(new JoinTokenEntity(), {
    id: 't1',
    tokenPrefix: 'lwj_abcdefghijkl',
    tokenHash: createHash('sha256').update(TOKEN).digest('hex'),
    site: 'default',
    labels: {},
    witness: false,
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  });
}

describe('JoinTokensService', () => {
  const repo = { findOne: jest.fn(), save: jest.fn(async (e: JoinTokenEntity) => e) };
  const manager = { getRepository: jest.fn(() => repo) } as never;
  const service = new JoinTokensService({} as never, {} as never, {} as never);

  afterEach(() => jest.clearAllMocks());

  it('parses only well-formed tokens', () => {
    expect(parseJoinToken(TOKEN)).toEqual({ prefix: 'lwj_abcdefghijkl' });
    expect(parseJoinToken('lwj_short.x')).toBeNull();
    expect(parseJoinToken(`${TOKEN}x`)).toBeNull();
    expect(parseJoinToken(`lwj_ABCDEFGHIJKL.${'A'.repeat(43)}`)).toBeNull();
  });

  it('consumes a valid token exactly once', async () => {
    repo.findOne.mockResolvedValue(tokenEntity());

    const consumed = await service.consume(manager, TOKEN, 'n1');

    expect(consumed.usedByNode).toBe('n1');
    expect(consumed.usedAt).toBeInstanceOf(Date);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { tokenPrefix: 'lwj_abcdefghijkl' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it.each([
    ['unknown', null],
    ['used', tokenEntity({ usedAt: new Date() })],
    ['revoked', tokenEntity({ revokedAt: new Date() })],
    ['expired', tokenEntity({ expiresAt: new Date(Date.now() - 1) })],
    ['wrong secret', tokenEntity({ tokenHash: 'f'.repeat(64) })],
  ])('rejects %s tokens with the same error', async (_label, entity) => {
    repo.findOne.mockResolvedValue(entity);

    await expect(service.consume(manager, TOKEN, 'n1')).rejects.toEqual(
      new UnauthorizedException('invalid or expired join token'),
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens without a database lookup', async () => {
    await expect(service.consume(manager, 'garbage', 'n1')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
