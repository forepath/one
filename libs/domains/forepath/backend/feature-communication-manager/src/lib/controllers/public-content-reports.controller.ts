import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TurnstileCaptcha } from 'nest-cloudflare-turnstile';

import { CONTENT_REPORT_PDF_MAX_BYTES, CONTENT_REPORT_PDF_MIME } from '../constants/content-report.constants';
import { ContentReportResponseDto } from '../dto/content-report-response.dto';
import { CreateContentReportDto } from '../dto/create-content-report.dto';
import { ContentReportService } from '../services/content-report.service';
import type { UploadedPdfFile } from '../utils/pdf-file.utils';

@Controller('public/content-reports')
export class PublicContentReportsController {
  constructor(private readonly contentReportService: ContentReportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @TurnstileCaptcha()
  @UseInterceptors(
    FileInterceptor('removalOrderPdf', {
      storage: memoryStorage(),
      limits: { fileSize: CONTENT_REPORT_PDF_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (file.mimetype !== CONTENT_REPORT_PDF_MIME) {
          callback(new BadRequestException('Only application/pdf uploads are allowed') as unknown as Error, false);

          return;
        }

        callback(null, true);
      },
    }),
  )
  submit(
    @Body() dto: CreateContentReportDto,
    @UploadedFile()
    removalOrderPdf?: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ): Promise<ContentReportResponseDto> {
    const uploadedPdf: UploadedPdfFile | undefined = removalOrderPdf
      ? {
          originalname: removalOrderPdf.originalname,
          mimetype: removalOrderPdf.mimetype,
          size: removalOrderPdf.size,
          buffer: removalOrderPdf.buffer,
        }
      : undefined;

    return this.contentReportService.submitContentReport(dto, uploadedPdf);
  }
}
