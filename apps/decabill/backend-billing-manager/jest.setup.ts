jest.mock('archiver', () => ({
  ZipArchive: jest.fn().mockImplementation(() => ({
    pipe: jest.fn((dest) => dest),
    append: jest.fn(),
    finalize: jest.fn(async () => undefined),
    on: jest.fn(),
  })),
}));
