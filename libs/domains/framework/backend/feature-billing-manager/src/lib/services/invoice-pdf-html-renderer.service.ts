import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';

@Injectable()
export class InvoicePdfHtmlRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoicePdfHtmlRendererService.name);
  private browserPromise: Promise<Browser> | null = null;

  async renderHtmlToPdf(html: string): Promise<Uint8Array> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'networkidle' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      });

      return new Uint8Array(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }

    try {
      const browser = await this.browserPromise;

      await browser.close();
    } catch (error) {
      this.logger.warn('Failed to close Playwright browser on shutdown', error);
    } finally {
      this.browserPromise = null;
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }

    return this.browserPromise;
  }
}
