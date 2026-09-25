import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';

import type { CreateFileDto, FileContentDto, FileNodeDto, MoveFileDto, WriteFileDto } from '../state/files/files.types';
import { AGENT_FILE_MAX_ASSEMBLED_BYTES, AGENT_FILE_MAX_CHUNK_BYTES } from '../state/files/files.types';
import { utf8ToArrayBuffer } from '../utils/agent-file-bytes';

import { FilesService } from './files.service';

describe('FilesService', () => {
  let service: FilesService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3100/api';
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const textBytes = (() => {
    const encoded = new TextEncoder().encode('Hello, World!');
    const copy = new ArrayBuffer(encoded.byteLength);

    new Uint8Array(copy).set(encoded);

    return copy;
  })();
  const expectedBodyRef = `${clientId}\u0000${agentId}\u0000app\u0000test-file.txt`;
  const mockFileContent: FileContentDto = {
    fileType: 'text',
    contentType: 'text/plain; charset=utf-8',
    text: 'Hello, World!',
    size: textBytes.byteLength,
    bodyRef: expectedBodyRef,
  };
  const mockFileNodes: FileNodeDto[] = [
    {
      name: 'file1.txt',
      type: 'file',
      path: 'file1.txt',
      size: 1024,
      modifiedAt: '2024-01-01T00:00:00Z',
    },
    {
      name: 'dir1',
      type: 'directory',
      path: 'dir1',
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            controller: {
              restApiUrl: apiUrl,
            },
          },
        },
      ],
    });

    service = TestBed.inject(FilesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('readFile', () => {
    it('should map raw bytes and headers to FileContentDto with bodyRef', (done) => {
      const filePath = 'test-file.txt';

      service.readFile(clientId, agentId, filePath).subscribe((content) => {
        expect(content.fileType).toBe(mockFileContent.fileType);
        expect(content.contentType).toBe(mockFileContent.contentType);
        expect(content.text).toBe(mockFileContent.text);
        expect(content.size).toBe(mockFileContent.size);
        expect(content.bodyRef).toBe(expectedBodyRef);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('arraybuffer');
      req.flush(textBytes, {
        status: 200,
        statusText: 'OK',
        headers: {
          'X-File-Type': 'text',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    });

    it('should append context=config for config file manager context', (done) => {
      const filePath = 'settings.json';

      service.readFile(clientId, agentId, filePath, 'config').subscribe((content) => {
        expect(content.fileType).toBe('text');
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}?context=config`,
      );

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('context')).toBe('config');
      req.flush(textBytes, {
        status: 200,
        statusText: 'OK',
        headers: {
          'X-File-Type': 'text',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should encode file path segments separately preserving forward slashes', (done) => {
      const filePath = 'folder/sub folder/file with spaces.txt';
      const expectedPath = 'folder/sub%20folder/file%20with%20spaces.txt';

      service.readFile(clientId, agentId, filePath).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${expectedPath}`);

      expect(req.request.method).toBe('GET');
      req.flush(textBytes, {
        status: 200,
        statusText: 'OK',
        headers: { 'X-File-Type': 'text', 'Content-Type': 'text/plain' },
      });
    });

    it('should store binary bytes in body store without text', (done) => {
      const filePath = 'image.png';
      const bytes = new ArrayBuffer(4);
      const bodyRef = `${clientId}\u0000${agentId}\u0000app\u0000${filePath}`;

      new Uint8Array(bytes).set([1, 2, 3, 4]);

      service.readFile(clientId, agentId, filePath).subscribe((content) => {
        expect(content.fileType).toBe('image');
        expect(content.text).toBeUndefined();
        expect(content.bodyRef).toBe(bodyRef);
        expect(content.size).toBe(4);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

      req.flush(bytes, {
        status: 200,
        statusText: 'OK',
        headers: { 'X-File-Type': 'image', 'Content-Type': 'image/png' },
      });
    });
  });

  describe('writeFile', () => {
    it('should PUT raw bytes for small files', (done) => {
      const filePath = 'test-file.txt';
      const writeDto: WriteFileDto = {
        bytes: utf8ToArrayBuffer('New content'),
        fileType: 'text',
        contentType: 'text/plain; charset=utf-8',
      };

      service.writeFile(clientId, agentId, filePath, writeDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toBe(writeDto.bytes);
      expect(req.request.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(req.request.headers.get('X-File-Type')).toBe('text');
      req.flush(null);
    });

    it('should append context=config on write when requested', (done) => {
      const filePath = 'settings.json';
      const writeDto: WriteFileDto = {
        bytes: utf8ToArrayBuffer('x'),
        fileType: 'text',
      };

      service.writeFile(clientId, agentId, filePath, writeDto, 'config').subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}?context=config`,
      );

      expect(req.request.method).toBe('PUT');
      expect(req.request.params.get('context')).toBe('config');
      req.flush(null);
    });

    it('should reject files larger than the assembled size limit', (done) => {
      const filePath = 'too-large.bin';
      const writeDto: WriteFileDto = {
        bytes: new ArrayBuffer(0),
        fileType: 'binary',
      };

      Object.defineProperty(writeDto.bytes, 'byteLength', { value: AGENT_FILE_MAX_ASSEMBLED_BYTES + 1 });

      service.writeFile(clientId, agentId, filePath, writeDto).subscribe({
        next: () => done.fail('expected error'),
        error: (error: Error) => {
          expect(error.message).toContain('maximum allowed size');
          done();
        },
      });
    });

    it('should upload large files in sequential Content-Range chunks', async () => {
      const filePath = 'large.bin';
      const total = AGENT_FILE_MAX_CHUNK_BYTES + 10;
      const bytes = new ArrayBuffer(total);
      const writeDto: WriteFileDto = { bytes, fileType: 'binary' };
      const progress: Array<[number, number]> = [];
      const done = new Promise<void>((resolve, reject) => {
        service
          .writeFile(clientId, agentId, filePath, writeDto, 'app', (loaded, totalBytes) => {
            progress.push([loaded, totalBytes]);
          })
          .subscribe({ next: () => resolve(), error: reject });
      });

      // Drain chunk requests as they appear
      const drain = async (): Promise<void> => {
        for (let i = 0; i < 20; i++) {
          const pending = httpMock.match(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

          for (const req of pending) {
            expect(req.request.headers.get('Content-Range')).toMatch(/^bytes \d+-\d+\/\d+$/);
            expect(req.request.headers.get('X-Upload-Id')).toBeTruthy();
            req.flush(null);
          }

          await Promise.resolve();
        }
      };

      await drain();
      await done;
      expect(progress[progress.length - 1]).toEqual([total, total]);
    });
  });

  describe('downloadFile', () => {
    it('should download empty files that reject Range with 416', async () => {
      const filePath = 'empty.mp3';
      const clickMock = jest.fn();
      const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue({
        click: clickMock,
        href: '',
        download: '',
        rel: '',
      } as unknown as HTMLAnchorElement);

      jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: jest.fn().mockReturnValue('blob:empty'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: jest.fn(),
      });

      const done = new Promise<void>((resolve, reject) => {
        service.downloadFile(clientId, agentId, filePath).subscribe({ next: () => resolve(), error: reject });
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}?download=true`);

      expect(req.request.headers.get('Range')).toBe('bytes=0-');
      req.flush(new ArrayBuffer(0), { status: 416, statusText: 'Range Not Satisfiable' });

      await done;
      expect(clickMock).toHaveBeenCalled();
      createElementSpy.mockRestore();
    });
  });

  describe('listDirectory', () => {
    it('should return directory listing', (done) => {
      service.listDirectory(clientId, agentId).subscribe((files) => {
        expect(files).toEqual(mockFileNodes);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files`);

      expect(req.request.method).toBe('GET');
      req.flush(mockFileNodes);
    });

    it('should include path parameter when provided', (done) => {
      const params = { path: 'subdirectory' };

      service.listDirectory(clientId, agentId, params).subscribe((files) => {
        expect(files).toEqual(mockFileNodes);
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files?path=subdirectory`);

      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('path')).toBe('subdirectory');
      req.flush(mockFileNodes);
    });

    it('should include context=config with list when params request config root', (done) => {
      service.listDirectory(clientId, agentId, { path: '.', context: 'config' }).subscribe((files) => {
        expect(files).toEqual(mockFileNodes);
        done();
      });

      const req = httpMock.expectOne(
        (r) =>
          r.url.startsWith(`${apiUrl}/clients/${clientId}/agents/${agentId}/files`) &&
          r.params.get('context') === 'config' &&
          r.params.get('path') === '.',
      );

      expect(req.request.method).toBe('GET');
      req.flush(mockFileNodes);
    });
  });

  describe('createFileOrDirectory', () => {
    it('should create a file without content', (done) => {
      const filePath = 'new-file.txt';
      const createDto: CreateFileDto = {
        type: 'file',
      };

      service.createFileOrDirectory(clientId, agentId, filePath, createDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(null);
    });

    it('should append context=config on create when requested', (done) => {
      const filePath = 'rules.md';
      const createDto: CreateFileDto = {
        type: 'file',
      };

      service.createFileOrDirectory(clientId, agentId, filePath, createDto, 'config').subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}?context=config`,
      );

      expect(req.request.method).toBe('POST');
      expect(req.request.params.get('context')).toBe('config');
      req.flush(null);
    });

    it('should create a directory', (done) => {
      const directoryPath = 'new-directory';
      const createDto: CreateFileDto = {
        type: 'directory',
      };

      service.createFileOrDirectory(clientId, agentId, directoryPath, createDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${directoryPath}`);

      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(createDto);
      req.flush(null);
    });
  });

  describe('deleteFileOrDirectory', () => {
    it('should delete a file', (done) => {
      const filePath = 'file-to-delete.txt';

      service.deleteFileOrDirectory(clientId, agentId, filePath).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}`);

      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('should append context=config on delete when requested', (done) => {
      const filePath = 'old.json';

      service.deleteFileOrDirectory(clientId, agentId, filePath, 'config').subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/files/${filePath}?context=config`,
      );

      expect(req.request.method).toBe('DELETE');
      expect(req.request.params.get('context')).toBe('config');
      req.flush(null);
    });
  });

  describe('moveFileOrDirectory', () => {
    it('should move a file', (done) => {
      const sourcePath = 'source-file.txt';
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };

      service.moveFileOrDirectory(clientId, agentId, sourcePath, moveDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${sourcePath}`);

      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(moveDto);
      req.flush(null);
    });

    it('should append context=config on move when requested', (done) => {
      const sourcePath = 'a.txt';
      const moveDto: MoveFileDto = {
        destination: 'b.txt',
      };

      service.moveFileOrDirectory(clientId, agentId, sourcePath, moveDto, 'config').subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(
        `${apiUrl}/clients/${clientId}/agents/${agentId}/files/${sourcePath}?context=config`,
      );

      expect(req.request.method).toBe('PATCH');
      expect(req.request.params.get('context')).toBe('config');
      req.flush(null);
    });

    it('should encode source path segments separately preserving forward slashes', (done) => {
      const sourcePath = 'tools/pAGENTZx.md';
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };

      service.moveFileOrDirectory(clientId, agentId, sourcePath, moveDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${sourcePath}`);

      expect(req.request.method).toBe('PATCH');
      req.flush(null);
    });

    it('should encode source path with special characters in segments', (done) => {
      const sourcePath = 'folder/sub folder/file with spaces.txt';
      const expectedPath = 'folder/sub%20folder/file%20with%20spaces.txt';
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };

      service.moveFileOrDirectory(clientId, agentId, sourcePath, moveDto).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne(`${apiUrl}/clients/${clientId}/agents/${agentId}/files/${expectedPath}`);

      expect(req.request.method).toBe('PATCH');
      req.flush(null);
    });
  });
});
