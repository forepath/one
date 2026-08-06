import { BadRequestException, Injectable } from '@nestjs/common';

import type { MeterAttachmentSource } from '../constants/meter-attachment.constants';
import { assertDeclaredMeterCollectionInterval, type DeclaredMeterDefinition } from '../dto/declared-meter.dto';
import type { AttachedMeterResponseDto, MeterResponseDto } from '../dto/meter-response.dto';
import type { CreateMeterDto, UpdateMeterDto } from '../dto/meter.dto';
import type { AddonEntity } from '../entities/addon.entity';
import type { AddonMeterEntity } from '../entities/addon-meter.entity';
import type { MeterEntity } from '../entities/meter.entity';
import type { ServicePlanMeterEntity } from '../entities/service-plan-meter.entity';
import type { ServiceTypeEntity } from '../entities/service-type.entity';
import type { ServiceTypeMeterEntity } from '../entities/service-type-meter.entity';
import { AddonMetersRepository } from '../repositories/addon-meters.repository';
import { MetersRepository } from '../repositories/meters.repository';
import { ServicePlanMetersRepository } from '../repositories/service-plan-meters.repository';
import { ServiceTypeMetersRepository } from '../repositories/service-type-meters.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import { resolveEffectiveUnitPriceNet } from '../utils/meter-aggregation.util';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { AddonModuleRegistryService } from './addon-module-registry.service';
import { ProviderRegistryService } from './provider-registry.service';

type MeterLinkEntity = ServicePlanMeterEntity | AddonMeterEntity | ServiceTypeMeterEntity;

@Injectable()
export class MeterService {
  constructor(
    private readonly metersRepository: MetersRepository,
    private readonly servicePlanMetersRepository: ServicePlanMetersRepository,
    private readonly addonMetersRepository: AddonMetersRepository,
    private readonly serviceTypeMetersRepository: ServiceTypeMetersRepository,
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly providerRegistry: ProviderRegistryService,
  ) {}

  mapMeterToResponse(row: MeterEntity): MeterResponseDto {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description ?? null,
      unitLabel: row.unitLabel ?? null,
      aggregator: row.aggregator,
      defaultUnitPriceNet: Number(row.defaultUnitPriceNet),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  mapAttachedMeter(
    link: MeterLinkEntity,
    meter: MeterEntity,
    options?: { inherited?: boolean },
  ): AttachedMeterResponseDto {
    const defaultUnitPriceNet = Number(meter.defaultUnitPriceNet);
    const unitPriceNetOverride =
      link.unitPriceNet === null || link.unitPriceNet === undefined ? null : Number(link.unitPriceNet);

    return {
      meterId: meter.id,
      key: meter.key,
      name: meter.name,
      description: meter.description ?? null,
      unitLabel: meter.unitLabel ?? null,
      aggregator: meter.aggregator,
      defaultUnitPriceNet,
      unitPriceNetOverride,
      effectiveUnitPriceNet: resolveEffectiveUnitPriceNet(unitPriceNetOverride, defaultUnitPriceNet),
      isActive: meter.isActive,
      source: link.source ?? 'manual',
      required: link.required === true,
      inherited: options?.inherited === true ? true : undefined,
    };
  }

  async ensureCatalogMeter(def: DeclaredMeterDefinition): Promise<MeterEntity> {
    assertDeclaredMeterCollectionInterval(def);

    const key = def.key.trim();
    const existing = await this.metersRepository.findByKey(key);

    if (existing) {
      return existing;
    }

    return await this.metersRepository.create({
      key,
      name: def.name.trim(),
      description: def.description?.trim() || null,
      unitLabel: def.unitLabel?.trim() || null,
      aggregator: def.aggregator,
      defaultUnitPriceNet: String(def.defaultUnitPriceNet),
      isActive: true,
    });
  }

  async syncAddonModuleMeters(addon: AddonEntity): Promise<AttachedMeterResponseDto[]> {
    if (addon.implementationType !== 'module' || !addon.moduleKey?.trim()) {
      return await this.listAddonMeters(addon.id);
    }

    const module = this.addonModuleRegistry.get(addon.moduleKey.trim());
    const declared = module?.meters ?? [];
    const declaredKeys = new Set(declared.map((item) => item.key.trim()));
    const existing = await this.addonMetersRepository.findByAddonId(addon.id);

    for (const def of declared) {
      const meter = await this.ensureCatalogMeter(def);
      const link = existing.find((row) => row.meterId === meter.id);

      if (!link) {
        await this.addonMetersRepository.create({
          addonId: addon.id,
          meterId: meter.id,
          unitPriceNet: null,
          source: 'module',
          required: true,
        });
        this.billingNotificationPublisher.publish('addon.meter_attached', {
          addonId: addon.id,
          meterId: meter.id,
          unitPriceNet: null,
          source: 'module',
          required: true,
        });
      } else if (link.source !== 'module' || link.required !== true) {
        await this.addonMetersRepository.update(link.id, { source: 'module', required: true });
      }
    }

    for (const link of existing) {
      if (link.source !== 'module') {
        continue;
      }

      const key = link.meter?.key;

      if (!key || declaredKeys.has(key)) {
        continue;
      }

      await this.addonMetersRepository.deleteByAddonAndMeter(addon.id, link.meterId);
      this.billingNotificationPublisher.publish('addon.meter_detached', {
        addonId: addon.id,
        meterId: link.meterId,
      });
    }

    return await this.listAddonMeters(addon.id);
  }

  async syncServiceTypeProviderMeters(serviceType: ServiceTypeEntity): Promise<AttachedMeterResponseDto[]> {
    const provider = this.providerRegistry.getProvider(serviceType.provider);
    const declared = provider?.meters ?? [];
    const declaredKeys = new Set(declared.map((item) => item.key.trim()));
    const existing = await this.serviceTypeMetersRepository.findByServiceTypeId(serviceType.id);

    for (const def of declared) {
      const meter = await this.ensureCatalogMeter(def);
      const link = existing.find((row) => row.meterId === meter.id);

      if (!link) {
        await this.serviceTypeMetersRepository.create({
          serviceTypeId: serviceType.id,
          meterId: meter.id,
          unitPriceNet: null,
          source: 'provider',
          required: true,
        });
        this.billingNotificationPublisher.publish('service_type.meter_attached', {
          serviceTypeId: serviceType.id,
          meterId: meter.id,
          unitPriceNet: null,
          source: 'provider',
          required: true,
        });
      } else if (link.source !== 'provider' || link.required !== true) {
        await this.serviceTypeMetersRepository.update(link.id, { source: 'provider', required: true });
      }
    }

    for (const link of existing) {
      if (link.source !== 'provider') {
        continue;
      }

      const key = link.meter?.key;

      if (!key || declaredKeys.has(key)) {
        continue;
      }

      await this.serviceTypeMetersRepository.deleteByServiceTypeAndMeter(serviceType.id, link.meterId);
      this.billingNotificationPublisher.publish('service_type.meter_detached', {
        serviceTypeId: serviceType.id,
        meterId: link.meterId,
      });
    }

    return await this.listServiceTypeMeters(serviceType.id);
  }

  async createMeter(dto: CreateMeterDto): Promise<MeterEntity> {
    const key = dto.key.trim();
    const existing = await this.metersRepository.findByKey(key);

    if (existing) {
      throw new BadRequestException('A meter with this key already exists');
    }

    const row = await this.metersRepository.create({
      key,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      unitLabel: dto.unitLabel?.trim() || null,
      aggregator: dto.aggregator,
      defaultUnitPriceNet: String(dto.defaultUnitPriceNet),
      isActive: dto.isActive ?? true,
    });

    this.billingNotificationPublisher.publish('meter.created', {
      meterId: row.id,
      key: row.key,
      name: row.name,
      aggregator: row.aggregator,
    });

    return row;
  }

  async updateMeter(id: string, dto: UpdateMeterDto): Promise<MeterEntity> {
    const patch: Partial<MeterEntity> = {};

    if (dto.name !== undefined) {
      patch.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      patch.description = dto.description?.trim() || null;
    }

    if (dto.unitLabel !== undefined) {
      patch.unitLabel = dto.unitLabel?.trim() || null;
    }

    if (dto.aggregator !== undefined) {
      patch.aggregator = dto.aggregator;
    }

    if (dto.defaultUnitPriceNet !== undefined) {
      patch.defaultUnitPriceNet = String(dto.defaultUnitPriceNet);
    }

    if (dto.isActive !== undefined) {
      patch.isActive = dto.isActive;
    }

    const row = await this.metersRepository.update(id, patch);

    this.billingNotificationPublisher.publish('meter.updated', {
      meterId: row.id,
      key: row.key,
      name: row.name,
      aggregator: row.aggregator,
      isActive: row.isActive,
    });

    return row;
  }

  async deleteMeter(id: string): Promise<void> {
    const row = await this.metersRepository.findByIdOrThrow(id);
    const planLinks = await this.servicePlanMetersRepository.countByMeterId(id);
    const addonLinks = await this.addonMetersRepository.countByMeterId(id);
    const typeLinks = await this.serviceTypeMetersRepository.countByMeterId(id);
    const usageCount = await this.usageRecordsRepository.countByMeterId(id);

    if (planLinks > 0 || addonLinks > 0 || typeLinks > 0 || usageCount > 0) {
      throw new BadRequestException(
        'Meter cannot be deleted while attached to plans/addons/service types or referenced by usage records; deactivate it instead',
      );
    }

    await this.metersRepository.delete(id);

    this.billingNotificationPublisher.publish('meter.deleted', {
      meterId: row.id,
      key: row.key,
    });
  }

  async listPlanMeters(servicePlanId: string): Promise<AttachedMeterResponseDto[]> {
    const links = await this.servicePlanMetersRepository.findByPlanId(servicePlanId);

    return links.filter((link) => link.meter).map((link) => this.mapAttachedMeter(link, link.meter!));
  }

  async listEffectivePlanMeters(
    servicePlanId: string,
    serviceTypeId?: string | null,
  ): Promise<AttachedMeterResponseDto[]> {
    const planMeters = await this.listPlanMeters(servicePlanId);
    const byMeterId = new Map(planMeters.map((item) => [item.meterId, item]));

    if (serviceTypeId) {
      const typeMeters = await this.listServiceTypeMeters(serviceTypeId);

      for (const meter of typeMeters) {
        if (byMeterId.has(meter.meterId)) {
          continue;
        }

        byMeterId.set(meter.meterId, { ...meter, inherited: true });
      }
    }

    return Array.from(byMeterId.values());
  }

  async attachPlanMeter(
    servicePlanId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const meter = await this.metersRepository.findByIdOrThrow(meterId);

    if (!meter.isActive) {
      throw new BadRequestException('Cannot attach an inactive meter');
    }

    const existing = await this.servicePlanMetersRepository.findByPlanAndMeter(servicePlanId, meterId);

    if (existing) {
      throw new BadRequestException('Meter is already attached to this plan');
    }

    const link = await this.servicePlanMetersRepository.create({
      servicePlanId,
      meterId,
      unitPriceNet: unitPriceNet === undefined ? null : unitPriceNet === null ? null : String(unitPriceNet),
      source: 'manual',
      required: false,
    });

    this.billingNotificationPublisher.publish('service_plan.meter_attached', {
      servicePlanId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(link, meter);
  }

  async updatePlanMeter(
    servicePlanId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const link = await this.servicePlanMetersRepository.findByPlanAndMeterOrThrow(servicePlanId, meterId);
    const meter = link.meter ?? (await this.metersRepository.findByIdOrThrow(meterId));
    const updated = await this.servicePlanMetersRepository.update(link.id, {
      unitPriceNet:
        unitPriceNet === undefined ? link.unitPriceNet : unitPriceNet === null ? null : String(unitPriceNet),
    });

    this.billingNotificationPublisher.publish('service_plan.meter_updated', {
      servicePlanId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(updated, meter);
  }

  async detachPlanMeter(servicePlanId: string, meterId: string): Promise<void> {
    const link = await this.servicePlanMetersRepository.findByPlanAndMeterOrThrow(servicePlanId, meterId);

    if (link.required === true) {
      throw new BadRequestException('Required meters cannot be detached');
    }

    await this.servicePlanMetersRepository.deleteByPlanAndMeter(servicePlanId, meterId);

    this.billingNotificationPublisher.publish('service_plan.meter_detached', {
      servicePlanId,
      meterId,
    });
  }

  async listAddonMeters(addonId: string): Promise<AttachedMeterResponseDto[]> {
    const links = await this.addonMetersRepository.findByAddonId(addonId);

    return links.filter((link) => link.meter).map((link) => this.mapAttachedMeter(link, link.meter!));
  }

  async attachAddonMeter(
    addonId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const meter = await this.metersRepository.findByIdOrThrow(meterId);

    if (!meter.isActive) {
      throw new BadRequestException('Cannot attach an inactive meter');
    }

    const existing = await this.addonMetersRepository.findByAddonAndMeter(addonId, meterId);

    if (existing) {
      throw new BadRequestException('Meter is already attached to this addon');
    }

    const link = await this.addonMetersRepository.create({
      addonId,
      meterId,
      unitPriceNet: unitPriceNet === undefined ? null : unitPriceNet === null ? null : String(unitPriceNet),
      source: 'manual',
      required: false,
    });

    this.billingNotificationPublisher.publish('addon.meter_attached', {
      addonId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(link, meter);
  }

  async updateAddonMeter(
    addonId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const link = await this.addonMetersRepository.findByAddonAndMeterOrThrow(addonId, meterId);
    const meter = link.meter ?? (await this.metersRepository.findByIdOrThrow(meterId));
    const updated = await this.addonMetersRepository.update(link.id, {
      unitPriceNet:
        unitPriceNet === undefined ? link.unitPriceNet : unitPriceNet === null ? null : String(unitPriceNet),
    });

    this.billingNotificationPublisher.publish('addon.meter_updated', {
      addonId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(updated, meter);
  }

  async detachAddonMeter(addonId: string, meterId: string): Promise<void> {
    const link = await this.addonMetersRepository.findByAddonAndMeterOrThrow(addonId, meterId);

    if (link.required === true) {
      throw new BadRequestException('Required meters cannot be detached');
    }

    await this.addonMetersRepository.deleteByAddonAndMeter(addonId, meterId);

    this.billingNotificationPublisher.publish('addon.meter_detached', {
      addonId,
      meterId,
    });
  }

  async listServiceTypeMeters(serviceTypeId: string): Promise<AttachedMeterResponseDto[]> {
    const links = await this.serviceTypeMetersRepository.findByServiceTypeId(serviceTypeId);

    return links.filter((link) => link.meter).map((link) => this.mapAttachedMeter(link, link.meter!));
  }

  async attachServiceTypeMeter(
    serviceTypeId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const meter = await this.metersRepository.findByIdOrThrow(meterId);

    if (!meter.isActive) {
      throw new BadRequestException('Cannot attach an inactive meter');
    }

    const existing = await this.serviceTypeMetersRepository.findByServiceTypeAndMeter(serviceTypeId, meterId);

    if (existing) {
      throw new BadRequestException('Meter is already attached to this service type');
    }

    const link = await this.serviceTypeMetersRepository.create({
      serviceTypeId,
      meterId,
      unitPriceNet: unitPriceNet === undefined ? null : unitPriceNet === null ? null : String(unitPriceNet),
      source: 'manual' satisfies MeterAttachmentSource,
      required: false,
    });

    this.billingNotificationPublisher.publish('service_type.meter_attached', {
      serviceTypeId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(link, meter);
  }

  async updateServiceTypeMeter(
    serviceTypeId: string,
    meterId: string,
    unitPriceNet?: number | null,
  ): Promise<AttachedMeterResponseDto> {
    const link = await this.serviceTypeMetersRepository.findByServiceTypeAndMeterOrThrow(serviceTypeId, meterId);
    const meter = link.meter ?? (await this.metersRepository.findByIdOrThrow(meterId));
    const updated = await this.serviceTypeMetersRepository.update(link.id, {
      unitPriceNet:
        unitPriceNet === undefined ? link.unitPriceNet : unitPriceNet === null ? null : String(unitPriceNet),
    });

    this.billingNotificationPublisher.publish('service_type.meter_updated', {
      serviceTypeId,
      meterId,
      unitPriceNet: unitPriceNet ?? null,
    });

    return this.mapAttachedMeter(updated, meter);
  }

  async detachServiceTypeMeter(serviceTypeId: string, meterId: string): Promise<void> {
    const link = await this.serviceTypeMetersRepository.findByServiceTypeAndMeterOrThrow(serviceTypeId, meterId);

    if (link.required === true) {
      throw new BadRequestException('Required meters cannot be detached');
    }

    await this.serviceTypeMetersRepository.deleteByServiceTypeAndMeter(serviceTypeId, meterId);

    this.billingNotificationPublisher.publish('service_type.meter_detached', {
      serviceTypeId,
      meterId,
    });
  }

  async isPlanMeterAttached(
    planId: string,
    serviceTypeId: string | null | undefined,
    meterId: string,
  ): Promise<boolean> {
    const planLink = await this.servicePlanMetersRepository.findByPlanAndMeter(planId, meterId);

    if (planLink) {
      return true;
    }

    if (!serviceTypeId) {
      return false;
    }

    const typeLink = await this.serviceTypeMetersRepository.findByServiceTypeAndMeter(serviceTypeId, meterId);

    return typeLink != null;
  }
}
