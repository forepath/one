import { generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import type { EntityManager } from 'typeorm';

import { VpnGatewayKeyEntity } from '../entities/vpn-client.entity';

export const ADVISORY_LOCK_VPN = 0x4c570011;
export const GATEWAY_KEY_ID = 'current';

/**
 * The remote access gateways' shared WireGuard key (3.31), created once — with the first compilation that has
 * remote access configured, so gateways can come up before anyone enrolls.
 */
export async function ensureVpnGatewayKey(manager: EntityManager): Promise<VpnGatewayKeyEntity> {
  const repo = manager.getRepository(VpnGatewayKeyEntity);
  const existing = await repo.findOne({ where: { id: GATEWAY_KEY_ID } });

  if (existing) return existing;

  await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_VPN]);

  const raced = await repo.findOne({ where: { id: GATEWAY_KEY_ID } });

  if (raced) return raced;

  const pair = generateWireguardKeyPair();

  return await repo.save(repo.create({ id: GATEWAY_KEY_ID, publicKey: pair.publicKey, privateKey: pair.privateKey }));
}
