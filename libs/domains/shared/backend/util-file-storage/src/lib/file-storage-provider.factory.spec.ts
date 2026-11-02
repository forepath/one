import { FileStorageProviderFactory } from './file-storage-provider.factory';
import type { FileStorageProvider } from './file-storage-provider.interface';

describe('FileStorageProviderFactory', () => {
  it('registers and resolves providers', () => {
    const factory = new FileStorageProviderFactory();
    const provider: FileStorageProvider = {
      getType: () => 'local',
      writeFile: jest.fn(),
      readFile: jest.fn(),
      fileExists: jest.fn(),
      deleteFile: jest.fn(),
    };

    factory.registerProvider(provider);

    expect(factory.getProvider('local')).toBe(provider);
    expect(factory.getRegisteredTypes()).toEqual(['local']);
  });

  it('throws with available types when provider is unknown', () => {
    const factory = new FileStorageProviderFactory();
    const provider: FileStorageProvider = {
      getType: () => 'local',
      writeFile: jest.fn(),
      readFile: jest.fn(),
      fileExists: jest.fn(),
      deleteFile: jest.fn(),
    };

    factory.registerProvider(provider);

    expect(() => factory.getProvider('locl')).toThrow("File storage provider 'locl' not found. Available: local");
  });

  it('throws Available: none when registry is empty', () => {
    const factory = new FileStorageProviderFactory();

    expect(() => factory.getProvider('local')).toThrow("File storage provider 'local' not found. Available: none");
  });
});
