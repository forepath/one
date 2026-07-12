import { RevokedUserTokenEntity } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class RevokedUserTokensRepository {
  constructor(
    @InjectRepository(RevokedUserTokenEntity)
    private readonly repository: Repository<RevokedUserTokenEntity>,
  ) {}

  async revoke(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await this.repository.save({ jti, userId, expiresAt });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const row = await this.repository.findOne({ where: { jti } });

    if (!row) {
      return false;
    }

    if (row.expiresAt <= new Date()) {
      await this.repository.delete({ jti });

      return false;
    }

    return true;
  }
}
