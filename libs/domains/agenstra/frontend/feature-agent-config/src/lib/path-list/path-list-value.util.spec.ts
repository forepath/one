import {
  classifyPathListValue,
  isEditableLocalPath,
  isLocalEditorPath,
  resolveLayerEditorPath,
} from './path-list-value.util';

describe('path-list-value.util', () => {
  it('classifies http(s) and git URLs', () => {
    expect(classifyPathListValue('https://example.com/skill')).toBe('url');
    expect(classifyPathListValue('http://example.com/a')).toBe('url');
    expect(classifyPathListValue('git@github.com:org/repo.git')).toBe('url');
  });

  it('classifies local paths', () => {
    expect(classifyPathListValue('./skills/foo')).toBe('local');
    expect(classifyPathListValue('.agenstra/layer/global/a.md')).toBe('local');
    expect(classifyPathListValue('/app/AGENTS.md')).toBe('local');
    expect(classifyPathListValue('skills/foo/SKILL.md')).toBe('local');
  });

  it('classifies directory globs as local and resolves to the folder before the first wildcard', () => {
    expect(classifyPathListValue('/opt/skills/*')).toBe('local');
    expect(classifyPathListValue('/opt/skills/**')).toBe('local');
    expect(classifyPathListValue('/opt/skills/**/*')).toBe('local');
    expect(classifyPathListValue('/opt/skills/**/abc')).toBe('local');
    expect(classifyPathListValue('/opt/skills/**/*.md')).toBe('local');
    expect(classifyPathListValue('skills/*')).toBe('local');
    expect(resolveLayerEditorPath('/opt/skills/*')).toBe('/opt/skills');
    expect(resolveLayerEditorPath('/opt/skills/**')).toBe('/opt/skills');
    expect(resolveLayerEditorPath('/opt/skills/**/*')).toBe('/opt/skills');
    expect(resolveLayerEditorPath('/opt/skills/**/abc')).toBe('/opt/skills');
    expect(resolveLayerEditorPath('/opt/skills/**/*.md')).toBe('/opt/skills');
    expect(resolveLayerEditorPath('skills/**/abc')).toBe('skills');
  });

  it('rejects globs without a directory prefix and bare package names', () => {
    expect(classifyPathListValue('**/*.md')).toBe('other');
    expect(classifyPathListValue('@scope/pkg')).toBe('other');
    expect(classifyPathListValue('opencode-plugin')).toBe('other');
    expect(resolveLayerEditorPath('**/*.md')).toBeNull();
    expect(resolveLayerEditorPath('**/abc')).toBeNull();
  });

  it('detects local editor paths independent of inheritance', () => {
    expect(isLocalEditorPath('./a.md')).toBe(true);
    expect(isLocalEditorPath('/opt/skills/**')).toBe(true);
    expect(isLocalEditorPath('https://x')).toBe(false);
    expect(isLocalEditorPath('**/*.md')).toBe(false);
  });

  it('only allows activating edit for non-inherited local paths and directory globs', () => {
    expect(isEditableLocalPath('./a.md', false)).toBe(true);
    expect(isEditableLocalPath('./a.md', true)).toBe(false);
    expect(isEditableLocalPath('/opt/skills/**', false)).toBe(true);
    expect(isEditableLocalPath('/opt/skills/**/abc', false)).toBe(true);
    expect(isEditableLocalPath('/opt/skills/**', true)).toBe(false);
    expect(isEditableLocalPath('https://x', false)).toBe(false);
    expect(isEditableLocalPath('**/*.md', false)).toBe(false);
  });
});
