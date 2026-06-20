import { InvoicePdfHtmlRendererService } from './invoice-pdf-html-renderer.service';

const pdfMock = jest.fn();
const setContentMock = jest.fn();
const closePageMock = jest.fn();
const newPageMock = jest.fn();
const closeBrowserMock = jest.fn();
const launchMock = jest.fn();

jest.mock('playwright', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}));

describe('InvoicePdfHtmlRendererService', () => {
  let service: InvoicePdfHtmlRendererService;

  beforeEach(() => {
    jest.clearAllMocks();
    pdfMock.mockResolvedValue(Buffer.from('pdf-bytes'));
    setContentMock.mockResolvedValue(undefined);
    closePageMock.mockResolvedValue(undefined);
    newPageMock.mockResolvedValue({
      setContent: setContentMock,
      pdf: pdfMock,
      close: closePageMock,
    });
    closeBrowserMock.mockResolvedValue(undefined);
    launchMock.mockResolvedValue({
      newPage: newPageMock,
      close: closeBrowserMock,
    });
    service = new InvoicePdfHtmlRendererService();
  });

  it('renders HTML to PDF via Playwright', async () => {
    const result = await service.renderHtmlToPdf('<html><body>Invoice</body></html>');

    expect(launchMock).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    expect(setContentMock).toHaveBeenCalledWith('<html><body>Invoice</body></html>', { waitUntil: 'networkidle' });
    expect(pdfMock).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });
    expect(closePageMock).toHaveBeenCalled();
    expect(result).toEqual(new Uint8Array(Buffer.from('pdf-bytes')));
  });

  it('reuses the browser instance across renders', async () => {
    await service.renderHtmlToPdf('<html></html>');
    await service.renderHtmlToPdf('<html></html>');

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(newPageMock).toHaveBeenCalledTimes(2);
  });

  it('closes the browser on module destroy', async () => {
    await service.renderHtmlToPdf('<html></html>');
    await service.onModuleDestroy();

    expect(closeBrowserMock).toHaveBeenCalled();
  });
});
