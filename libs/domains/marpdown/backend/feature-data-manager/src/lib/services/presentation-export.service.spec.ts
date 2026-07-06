import { ExportFormat } from '@forepath/marpdown/marpdown/shared';
import { promises as fs } from 'fs';

import { PresentationExportService } from './presentation-export.service';

const marpCliMock = jest.fn().mockImplementation(async (args: string[]) => {
  const outputIndex = args.indexOf('-o');

  if (outputIndex >= 0) {
    await fs.writeFile(args[outputIndex + 1], 'pdf-bytes');
  }

  return 0;
});

jest.mock('@marp-team/marp-cli', () => ({
  marpCli: (...args: unknown[]) => marpCliMock(...args),
}));

jest.mock('playwright', () => ({
  chromium: {
    executablePath: () => '/usr/bin/chromium',
  },
}));

describe('PresentationExportService', () => {
  beforeEach(() => {
    marpCliMock.mockClear();
  });

  it('exports using marp cli with local files enabled', async () => {
    const presentationsRepository = {
      findByIdOrThrow: jest.fn().mockResolvedValue({
        id: 'p1',
        userId: 'user-1',
        title: 'Deck',
        markdown: '# Hello',
      }),
    };
    const assetsService = {
      listAllFilesForExport: jest.fn().mockResolvedValue([]),
    };
    const service = new PresentationExportService(
      presentationsRepository as never,
      assetsService as never,
    );

    const result = await service.exportPresentation(
      { userId: 'user-1', isApiKeyAuth: false },
      'p1',
      ExportFormat.PDF,
    );

    expect(marpCliMock).toHaveBeenCalledWith(
      expect.arrayContaining(['--allow-local-files', '--pdf', '--browser-path', '/usr/bin/chromium']),
    );
    expect(result).toBeDefined();
  });
});
