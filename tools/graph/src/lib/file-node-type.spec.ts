import { fileNodeTypeFromKind } from './schema';

describe('fileNodeTypeFromKind', () => {
  it('should map specs, docs, readmes, and diagrams to dedicated types', () => {
    expect(fileNodeTypeFromKind('openapi')).toBe('openapi');
    expect(fileNodeTypeFromKind('asyncapi')).toBe('asyncapi');
    expect(fileNodeTypeFromKind('mmd')).toBe('diagram');
    expect(fileNodeTypeFromKind('md', 'docs/decabill/features/webhooks.md')).toBe('doc');
    expect(fileNodeTypeFromKind('md', 'libs/foo/README.md')).toBe('readme');
    expect(fileNodeTypeFromKind('md', 'AGENTS.md')).toBe('readme');
    expect(fileNodeTypeFromKind('ts')).toBe('file');
  });
});
