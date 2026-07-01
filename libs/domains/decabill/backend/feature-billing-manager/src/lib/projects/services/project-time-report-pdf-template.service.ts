import { Injectable } from '@nestjs/common';
import * as Handlebars from 'handlebars';

import { loadTimeReportPdfTemplate } from '../../templates/time-report-pdf-template.loader';

import type { ProjectTimeReportViewModel } from './project-time-report-pdf-view.model';

@Injectable()
export class ProjectTimeReportPdfTemplateService {
  private readonly compiledTemplate = Handlebars.compile(loadTimeReportPdfTemplate());

  buildHtml(viewModel: ProjectTimeReportViewModel): string {
    return this.compiledTemplate(viewModel);
  }

  buildViewModel(input: ProjectTimeReportViewModel): ProjectTimeReportViewModel {
    return input;
  }
}
