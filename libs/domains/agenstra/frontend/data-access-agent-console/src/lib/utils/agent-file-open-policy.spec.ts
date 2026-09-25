import {
  AGENT_FILE_MAX_ASSEMBLED_BYTES,
  AGENT_FILE_MAX_CHUNK_BYTES,
  type FileProbeDto,
} from '../state/files/files.types';

import { shouldFetchFileBodyOnOpen } from './agent-file-open-policy';

describe('shouldFetchFileBodyOnOpen', () => {
  const base: FileProbeDto = {
    fileType: 'text',
    contentType: 'text/plain',
    size: 100,
  };

  it('fetches text/media under the single-GET budget', () => {
    expect(shouldFetchFileBodyOnOpen(base)).toBe(true);
    expect(shouldFetchFileBodyOnOpen({ ...base, fileType: 'image', contentType: 'image/png' })).toBe(true);
    expect(shouldFetchFileBodyOnOpen({ ...base, fileType: 'audio', contentType: 'audio/mpeg' })).toBe(true);
  });

  it('skips binary regardless of size', () => {
    expect(shouldFetchFileBodyOnOpen({ ...base, fileType: 'binary', contentType: 'application/octet-stream' })).toBe(
      false,
    );
  });

  it('skips text over the single-chunk editor budget', () => {
    expect(shouldFetchFileBodyOnOpen({ ...base, size: AGENT_FILE_MAX_CHUNK_BYTES + 1 })).toBe(false);
  });

  it('fetches media up to the assembled upload ceiling', () => {
    expect(
      shouldFetchFileBodyOnOpen({
        fileType: 'pdf',
        contentType: 'application/pdf',
        size: AGENT_FILE_MAX_CHUNK_BYTES + 1,
      }),
    ).toBe(true);
    expect(
      shouldFetchFileBodyOnOpen({
        fileType: 'pdf',
        contentType: 'application/pdf',
        size: AGENT_FILE_MAX_ASSEMBLED_BYTES,
      }),
    ).toBe(true);
  });

  it('skips anything over the assembled upload ceiling', () => {
    expect(
      shouldFetchFileBodyOnOpen({
        fileType: 'pdf',
        contentType: 'application/pdf',
        size: AGENT_FILE_MAX_ASSEMBLED_BYTES + 1,
      }),
    ).toBe(false);
  });
});
