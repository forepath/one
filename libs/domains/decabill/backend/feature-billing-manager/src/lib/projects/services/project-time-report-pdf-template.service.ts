import { Injectable, Optional } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import {
  BillingDocumentBrandingConfigService,
  DEFAULT_DOCUMENT_BRANDING,
} from '../../services/billing-document-branding-config.service';
import { loadTimeReportPdfTemplate } from '../../templates/time-report-pdf-template.loader';

import type { ProjectTimeReportViewModel } from './project-time-report-pdf-view.model';

@Injectable()
export class ProjectTimeReportPdfTemplateService {
  private readonly compiledTemplate = Handlebars.compile(loadTimeReportPdfTemplate());

  constructor(@Optional() private readonly brandingConfig?: BillingDocumentBrandingConfigService) {}

  buildHtml(viewModel: ProjectTimeReportViewModel): string {
    return this.compiledTemplate(this.buildViewModel(viewModel));
  }

  /** Adds the document branding (resolved in the current tenant context) unless the input already carries one. */
  buildViewModel(input: ProjectTimeReportViewModel): ProjectTimeReportViewModel {
    return input.branding
      ? input
      : { ...input, branding: this.brandingConfig?.getBranding() ?? DEFAULT_DOCUMENT_BRANDING };
  }
}
