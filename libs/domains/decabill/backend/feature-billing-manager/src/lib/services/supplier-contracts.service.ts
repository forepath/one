import { Injectable } from '@nestjs/common';

import type { SupplierContractResponseDto } from '../dto/admin-supplier-profile.dto';
import { SupplierContractsRepository } from '../repositories/supplier-contracts.repository';
import { SupplierProfilesRepository } from '../repositories/supplier-profiles.repository';

@Injectable()
export class SupplierContractsService {
  constructor(
    private readonly supplierContractsRepository: SupplierContractsRepository,
    private readonly supplierProfilesRepository: SupplierProfilesRepository,
  ) {}

  async searchBySupplier(supplierId: string, search?: string): Promise<SupplierContractResponseDto[]> {
    await this.supplierProfilesRepository.findByIdOrThrow(supplierId);
    const contracts = await this.supplierContractsRepository.searchBySupplier(supplierId, search);

    return contracts.map((contract) => this.mapResponse(contract));
  }

  async getOrCreateByNumber(supplierId: string, contractNumber: string): Promise<SupplierContractResponseDto> {
    await this.supplierProfilesRepository.findByIdOrThrow(supplierId);
    const normalized = contractNumber.trim();
    const existing = await this.supplierContractsRepository.findBySupplierAndNumber(supplierId, normalized);

    if (existing) {
      return this.mapResponse(existing);
    }

    const created = await this.supplierContractsRepository.create(supplierId, normalized);

    return this.mapResponse(created);
  }

  private mapResponse(contract: {
    id: string;
    supplierId: string;
    contractNumber: string;
    createdAt: Date;
  }): SupplierContractResponseDto {
    return {
      id: contract.id,
      supplierId: contract.supplierId,
      contractNumber: contract.contractNumber,
      createdAt: contract.createdAt,
    };
  }
}
