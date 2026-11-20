import {
  code128Geometry,
  gtinBarcodeGeometry,
  isCode128Encodable,
  isValidGtin,
  renderBarcodeSvg,
} from '@forepath/shared/shared/util-barcode';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { InvoicePdfHtmlRendererService } from '../../services/invoice-pdf-html-renderer.service';
import { loadInventoryLabelsTemplate } from '../../templates/inventory-labels-template.loader';
import {
  INVENTORY_LABELS_MAX,
  type InventoryLabelKind,
  InventorySerialUnitStatus,
} from '../constants/inventory.constants';
import type { InventoryLabelOwnerResponseDto, PrintInventoryLabelsDto } from '../dto/inventory.dto';
import type { InventoryArticleEntity } from '../entities/inventory-article.entity';
import type { InventorySerialUnitEntity } from '../entities/inventory-serial-unit.entity';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventorySerialUnitsRepository } from '../repositories/inventory-serial-units.repository';

const LABELS_PER_SHEET = 24;

export interface InventoryLabelViewModel {
  kind: InventoryLabelKind;
  property: boolean;
  title: string;
  barcodeSvg: string;
  serialNumber: string | null;
  ownerName: string;
  ownerAddress: string | null;
  ownerContact: string | null;
}

interface LabelSubject {
  article: InventoryArticleEntity;
  unit: InventorySerialUnitEntity | null;
}

/**
 * Printable labels for articles and serial-tracked units, exported synchronously as one PDF: article number
 * (Code 128), EAN, and property stickers naming the issuer (`BILLING_ISSUER_*`) as owner. Articles without an EAN
 * get no EAN label; serial-tracked articles get one property sticker per unit in stock or on loan.
 */
@Injectable()
export class InventoryLabelsService {
  private readonly template = Handlebars.compile(loadInventoryLabelsTemplate());

  constructor(
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly serialUnits: InventorySerialUnitsRepository,
    private readonly htmlRenderer: InvoicePdfHtmlRendererService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
  ) {}

  async render(dto: PrintInventoryLabelsDto): Promise<{ buffer: Buffer; fileName: string; count: number }> {
    const labels = await this.buildLabels(dto);
    const single = dto.layout === 'single';
    const pages: InventoryLabelViewModel[][] = [];

    for (let index = 0; index < labels.length; index += single ? labels.length : LABELS_PER_SHEET) {
      pages.push(labels.slice(index, index + (single ? labels.length : LABELS_PER_SHEET)));
    }

    const html = this.template({ single, pages });
    const buffer = Buffer.from(await this.htmlRenderer.renderHtmlToPdf(html, { cssPageSize: true }));
    const stamp = new Date().toISOString().slice(0, 10);

    return { buffer, fileName: `labels-${stamp}.pdf`, count: labels.length };
  }

  /** Labels in selection order (each subject's kinds together), repeated `copies` times. */
  async buildLabels(dto: PrintInventoryLabelsDto): Promise<InventoryLabelViewModel[]> {
    const owner = this.owner();

    if (dto.kinds.includes('property') && !owner.ownerName) {
      throw new BadRequestException('Property stickers need the company name (BILLING_ISSUER_NAME)');
    }

    const subjects = await this.subjects(dto);
    const copies = dto.copies ?? 1;
    const labels: InventoryLabelViewModel[] = [];

    for (const subject of subjects.direct) {
      for (const kind of dto.kinds) {
        if (kind === 'property' && !subject.unit && subject.article.serialTracking) {
          // Serial-tracked article: one sticker per tracked unit (an article without units gets the article sticker).
          const units = subjects.unitsByArticle.get(subject.article.id) ?? [];

          for (const unit of units.length > 0 ? units : [null]) {
            this.push(labels, this.label(kind, { article: subject.article, unit }, owner), copies);
          }

          continue;
        }

        this.push(labels, this.label(kind, subject, owner), copies);
      }
    }

    if (labels.length === 0) {
      throw new BadRequestException('Nothing to print: the selection has no labels of these kinds (no EAN?)');
    }

    if (labels.length > INVENTORY_LABELS_MAX) {
      throw new BadRequestException(`At most ${INVENTORY_LABELS_MAX} labels per print (${labels.length} requested)`);
    }

    return labels;
  }

  private push(labels: InventoryLabelViewModel[], label: InventoryLabelViewModel | null, copies: number): void {
    if (!label) {
      return;
    }

    for (let copy = 0; copy < copies; copy++) {
      labels.push(label);

      // Guard the loop itself, not only the final count (copies × units can be large).
      if (labels.length > INVENTORY_LABELS_MAX) {
        throw new BadRequestException(`At most ${INVENTORY_LABELS_MAX} labels per print`);
      }
    }
  }

  private async subjects(dto: PrintInventoryLabelsDto): Promise<{
    direct: LabelSubject[];
    unitsByArticle: Map<string, InventorySerialUnitEntity[]>;
  }> {
    const articleIds = dto.articleIds ?? [];
    const unitIds = dto.serialUnitIds ?? [];

    if (articleIds.length === 0 && unitIds.length === 0) {
      throw new BadRequestException('Select articles or serial numbers to print');
    }

    // Tenant-scoped lookups: foreign ids are "not found".
    const articles = new Map(
      (await this.articlesRepository.findByIds(articleIds)).map((article) => [article.id, article]),
    );
    const missingArticles = articleIds.filter((id) => !articles.has(id));

    if (missingArticles.length > 0) {
      throw new NotFoundException(`Articles not found: ${missingArticles.join(', ')}`);
    }

    const units = unitIds.length > 0 ? (await this.serialUnits.findAll(unitIds.length, 0, { ids: unitIds })).items : [];
    const unitsById = new Map(units.map((unit) => [unit.id, unit]));
    const missingUnits = unitIds.filter((id) => !unitsById.has(id));

    if (missingUnits.length > 0) {
      throw new NotFoundException(`Serial units not found: ${missingUnits.join(', ')}`);
    }

    const unitsByArticle = new Map<string, InventorySerialUnitEntity[]>();

    if (dto.kinds.includes('property')) {
      for (const article of articles.values()) {
        if (!article.serialTracking) {
          continue;
        }

        const tracked = await this.serialUnits.findAll(INVENTORY_LABELS_MAX + 1, 0, {
          articleId: article.id,
          statuses: [InventorySerialUnitStatus.IN_STOCK, InventorySerialUnitStatus.LENT],
        });

        unitsByArticle.set(article.id, tracked.items);
      }
    }

    return {
      direct: [
        ...articleIds.map((id) => ({ article: articles.get(id)!, unit: null })),
        ...unitIds.map((id) => ({ article: unitsById.get(id)!.article!, unit: unitsById.get(id)! })),
      ],
      unitsByArticle,
    };
  }

  private label(
    kind: InventoryLabelKind,
    subject: LabelSubject,
    owner: Pick<InventoryLabelViewModel, 'ownerName' | 'ownerAddress' | 'ownerContact'>,
  ): InventoryLabelViewModel | null {
    const { article, unit } = subject;
    const serial = unit?.serialNumber ?? null;
    const svgOptions = { moduleWidth: 2, height: 56 };
    let barcodeSvg: string;

    switch (kind) {
      case 'ean':
        if (!article.ean || !isValidGtin(article.ean)) {
          return null;
        }

        barcodeSvg = renderBarcodeSvg(gtinBarcodeGeometry(article.ean), svgOptions);
        break;

      case 'property': {
        // The unit's serial number identifies the device; without one the article number.
        const code = serial && isCode128Encodable(serial) ? serial : article.articleNumber;

        barcodeSvg = isCode128Encodable(code) ? renderBarcodeSvg(code128Geometry(code), svgOptions) : '';
        break;
      }

      default:
        barcodeSvg = isCode128Encodable(article.articleNumber)
          ? renderBarcodeSvg(code128Geometry(article.articleNumber), svgOptions)
          : '';
    }

    return {
      kind,
      property: kind === 'property',
      title: kind === 'property' && serial ? `${article.name}, ${article.articleNumber}` : article.name,
      barcodeSvg,
      serialNumber: kind === 'property' ? null : serial,
      ...owner,
    };
  }

  /** Owner printed on property stickers (preview in the console). */
  ownerInfo(): InventoryLabelOwnerResponseDto {
    const owner = this.owner();

    return { name: owner.ownerName || null, address: owner.ownerAddress, contact: owner.ownerContact };
  }

  private owner(): Pick<InventoryLabelViewModel, 'ownerName' | 'ownerAddress' | 'ownerContact'> {
    const issuer = this.billingIssuerConfig.getConfig();
    const cityLine = [issuer.postalCode, issuer.city].filter(Boolean).join(' ');
    const address = [issuer.addressLine1, cityLine].filter(Boolean).join(', ');

    return {
      ownerName: issuer.name?.trim() ?? '',
      ownerAddress: address || null,
      ownerContact: issuer.email?.trim() || null,
    };
  }
}
