import { fileIconClassForName, fileIconNameForName } from './file-icon.util';
import * as bootstrapIcons from 'bootstrap-icons/font/bootstrap-icons.json';

describe('fileIconClassForName', () => {
  it('maps known extensions to filetype icons', () => {
    expect(fileIconClassForName('src/app/main.ts')).toBe('bi-file-earmark');
    expect(fileIconClassForName('src/app/main.tsx')).toBe('bi-filetype-tsx');
    expect(fileIconClassForName('README.md')).toBe('bi-filetype-md');
    expect(fileIconClassForName('track.mp3')).toBe('bi-file-earmark-music');
  });

  it.each([
    'ts',
    'tsx',
    'js',
    'json',
    'html',
    'css',
    'scss',
    'md',
    'yaml',
    'yml',
    'xml',
    'py',
    'java',
    'c',
    'cpp',
    'php',
    'go',
    'rs',
    'mp3',
    'wav',
    'flac',
    'm4a',
    'aac',
    'oga',
    'ogg',
    'opus',
    'vue',
    'unknown',
  ])('only returns installed Bootstrap icons for .%s', (extension) => {
    expect(bootstrapIcons).toHaveProperty(fileIconNameForName(`file.${extension}`));
  });

  it.each(['ts', 'c', 'cpp', 'go', 'rs', 'vue'])('uses the normal file icon for .%s', (extension) => {
    expect(fileIconClassForName(`file.${extension}`)).toBe('bi-file-earmark');
  });

  it('falls back for unknown extensions', () => {
    expect(fileIconClassForName('notes.xyz')).toBe('bi-file-earmark');
    expect(fileIconClassForName('Makefile')).toBe('bi-file-earmark');
  });
});

describe('fileIconNameForName', () => {
  it('strips the bi- prefix for fpc icon inputs', () => {
    expect(fileIconNameForName('app.component.ts')).toBe('file-earmark');
  });
});
