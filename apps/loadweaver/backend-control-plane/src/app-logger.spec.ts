import { Logger } from '@nestjs/common';

import { appLogger, installAppLogger } from './app-logger';

describe('installAppLogger (3.43 live test: first lines after a restart were coloured text)', () => {
  it('makes every Logger write JSON without colours from the first line on', () => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(installAppLogger()).toBe(appLogger);
      new Logger('DatabaseHandover').log('Control-plane database: external');
      Logger.log('static line', 'Bootstrap');

      const lines = out.mock.calls.map(([chunk]) => String(chunk));

      expect(lines).toHaveLength(2);

      for (const line of lines) {
        // eslint-disable-next-line no-control-regex -- no ANSI colour codes
        expect(line).not.toMatch(/\u001b\[/);
        expect(JSON.parse(line)).toMatchObject({ level: 'log' });
      }

      expect(JSON.parse(lines[0])).toMatchObject({
        context: 'DatabaseHandover',
        message: 'Control-plane database: external',
      });
      expect(JSON.parse(lines[1])).toMatchObject({ context: 'Bootstrap', message: 'static line' });
    } finally {
      out.mockRestore();
    }
  });
});
