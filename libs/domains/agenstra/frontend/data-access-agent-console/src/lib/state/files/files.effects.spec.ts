import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { FilesService } from '../../services/files.service';

import {
  createFileOrDirectory,
  createFileOrDirectoryFailure,
  createFileOrDirectorySuccess,
  deleteFileOrDirectory,
  deleteFileOrDirectoryFailure,
  deleteFileOrDirectorySuccess,
  listDirectory,
  listDirectoryFailure,
  listDirectorySuccess,
  moveFileOrDirectory,
  moveFileOrDirectoryFailure,
  moveFileOrDirectorySuccess,
  readFile,
  readFileFailure,
  readFileSuccess,
  writeFile,
  writeFileFailure,
  writeFileSuccess,
} from './files.actions';
import {
  createFileOrDirectory$,
  deleteFileOrDirectory$,
  listDirectory$,
  moveFileOrDirectory$,
  readFile$,
  writeFile$,
} from './files.effects';
import type { CreateFileDto, FileContentDto, FileNodeDto, MoveFileDto, WriteFileDto } from './files.types';

describe('FilesEffects', () => {
  let actions$: Actions;
  let filesService: jest.Mocked<FilesService>;
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const mockFileContent: FileContentDto = {
    content: Buffer.from('Hello, World!', 'utf-8').toString('base64'),
    encoding: 'utf-8',
  };
  const mockFileNodes: FileNodeDto[] = [
    {
      name: 'file1.txt',
      type: 'file',
      path: 'file1.txt',
      size: 1024,
      modifiedAt: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    filesService = {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      listDirectory: jest.fn(),
      createFileOrDirectory: jest.fn(),
      deleteFileOrDirectory: jest.fn(),
      moveFileOrDirectory: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: FilesService,
          useValue: filesService,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('readFile$', () => {
    it('should return readFileSuccess on success', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const outcome = readFileSuccess({
        clientId,
        agentId,
        filePath,
        content: mockFileContent,
        context: 'app',
      });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(of(mockFileContent));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.readFile).toHaveBeenCalledWith(clientId, agentId, filePath, 'app');
        done();
      });
    });

    it('should return readFileFailure on error', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const error = new Error('Read failed');
      const outcome = readFileFailure({ clientId, agentId, filePath, error: 'Read failed', context: 'app' });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(throwError(() => error));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.readFile).toHaveBeenCalledWith(clientId, agentId, filePath, 'app');
        done();
      });
    });

    it('should forward config context to FilesService and success action', (done) => {
      const filePath = 'settings.json';
      const action = readFile({ clientId, agentId, filePath, context: 'config' });
      const outcome = readFileSuccess({
        clientId,
        agentId,
        filePath,
        content: mockFileContent,
        context: 'config',
      });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(of(mockFileContent));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.readFile).toHaveBeenCalledWith(clientId, agentId, filePath, 'config');
        done();
      });
    });
  });

  describe('writeFile$', () => {
    it('should return writeFileSuccess on success', (done) => {
      const filePath = 'test-file.txt';
      const writeDto: WriteFileDto = {
        content: Buffer.from('New content', 'utf-8').toString('base64'),
        encoding: 'utf-8',
      };
      const action = writeFile({ clientId, agentId, filePath, writeFileDto: writeDto });
      const outcome = writeFileSuccess({ clientId, agentId, filePath, context: 'app' });

      actions$ = of(action);
      filesService.writeFile.mockReturnValue(of(undefined));

      writeFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.writeFile).toHaveBeenCalledWith(clientId, agentId, filePath, writeDto, 'app');
        done();
      });
    });

    it('should return writeFileFailure on error', (done) => {
      const filePath = 'test-file.txt';
      const writeDto: WriteFileDto = {
        content: Buffer.from('New content', 'utf-8').toString('base64'),
      };
      const action = writeFile({ clientId, agentId, filePath, writeFileDto: writeDto });
      const error = new Error('Write failed');
      const outcome = writeFileFailure({ clientId, agentId, filePath, error: 'Write failed', context: 'app' });

      actions$ = of(action);
      filesService.writeFile.mockReturnValue(throwError(() => error));

      writeFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.writeFile).toHaveBeenCalledWith(clientId, agentId, filePath, writeDto, 'app');
        done();
      });
    });
  });

  describe('listDirectory$', () => {
    it('should return listDirectorySuccess on success', (done) => {
      const directoryPath = '.';
      const action = listDirectory({ clientId, agentId });
      const outcome = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath,
        files: mockFileNodes,
        context: 'app',
      });

      actions$ = of(action);
      filesService.listDirectory.mockReturnValue(of(mockFileNodes));

      listDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should use provided path parameter', (done) => {
      const directoryPath = 'subdirectory';
      const action = listDirectory({ clientId, agentId, params: { path: directoryPath } });
      const outcome = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath,
        files: mockFileNodes,
        context: 'app',
      });

      actions$ = of(action);
      filesService.listDirectory.mockReturnValue(of(mockFileNodes));

      listDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.listDirectory).toHaveBeenCalledWith(clientId, agentId, { path: directoryPath });
        done();
      });
    });

    it('should return listDirectoryFailure on error', (done) => {
      const action = listDirectory({ clientId, agentId });
      const error = new Error('List failed');
      const outcome = listDirectoryFailure({
        clientId,
        agentId,
        directoryPath: '.',
        error: 'List failed',
        context: 'app',
      });

      actions$ = of(action);
      filesService.listDirectory.mockReturnValue(throwError(() => error));

      listDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should forward config context for list directory', (done) => {
      const directoryPath = '.';
      const action = listDirectory({ clientId, agentId, params: { context: 'config' } });
      const outcome = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath,
        files: mockFileNodes,
        context: 'config',
      });

      actions$ = of(action);
      filesService.listDirectory.mockReturnValue(of(mockFileNodes));

      listDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.listDirectory).toHaveBeenCalledWith(clientId, agentId, { context: 'config' });
        done();
      });
    });
  });

  describe('createFileOrDirectory$', () => {
    it('should return createFileOrDirectorySuccess on success', (done) => {
      const filePath = 'new-file.txt';
      const createDto: CreateFileDto = {
        type: 'file',
        content: Buffer.from('File content', 'utf-8').toString('base64'),
      };
      const action = createFileOrDirectory({ clientId, agentId, filePath, createFileDto: createDto });
      const outcome = createFileOrDirectorySuccess({
        clientId,
        agentId,
        filePath,
        fileType: 'file',
        context: 'app',
      });

      actions$ = of(action);
      filesService.createFileOrDirectory.mockReturnValue(of(undefined));

      createFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.createFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, filePath, createDto, 'app');
        done();
      });
    });

    it('should return createFileOrDirectoryFailure on error', (done) => {
      const filePath = 'new-file.txt';
      const createDto: CreateFileDto = {
        type: 'file',
      };
      const action = createFileOrDirectory({ clientId, agentId, filePath, createFileDto: createDto });
      const error = new Error('Create failed');
      const outcome = createFileOrDirectoryFailure({
        clientId,
        agentId,
        filePath,
        error: 'Create failed',
        context: 'app',
      });

      actions$ = of(action);
      filesService.createFileOrDirectory.mockReturnValue(throwError(() => error));

      createFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('deleteFileOrDirectory$', () => {
    it('should return deleteFileOrDirectorySuccess on success', (done) => {
      const filePath = 'file-to-delete.txt';
      const action = deleteFileOrDirectory({ clientId, agentId, filePath });
      const outcome = deleteFileOrDirectorySuccess({ clientId, agentId, filePath, context: 'app' });

      actions$ = of(action);
      filesService.deleteFileOrDirectory.mockReturnValue(of(undefined));

      deleteFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.deleteFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, filePath, 'app');
        done();
      });
    });

    it('should return deleteFileOrDirectoryFailure on error', (done) => {
      const filePath = 'file-to-delete.txt';
      const action = deleteFileOrDirectory({ clientId, agentId, filePath });
      const error = new Error('Delete failed');
      const outcome = deleteFileOrDirectoryFailure({
        clientId,
        agentId,
        filePath,
        error: 'Delete failed',
        context: 'app',
      });

      actions$ = of(action);
      filesService.deleteFileOrDirectory.mockReturnValue(throwError(() => error));

      deleteFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('moveFileOrDirectory$', () => {
    it('should return moveFileOrDirectorySuccess on success', (done) => {
      const sourcePath = 'source-file.txt';
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };
      const action = moveFileOrDirectory({ clientId, agentId, sourcePath, moveFileDto: moveDto });
      const outcome = moveFileOrDirectorySuccess({
        clientId,
        agentId,
        sourcePath,
        destinationPath: moveDto.destination,
        context: 'app',
      });

      actions$ = of(action);
      filesService.moveFileOrDirectory.mockReturnValue(of(undefined));

      moveFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(filesService.moveFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, sourcePath, moveDto, 'app');
        done();
      });
    });

    it('should return moveFileOrDirectoryFailure on error', (done) => {
      const sourcePath = 'source-file.txt';
      const moveDto: MoveFileDto = {
        destination: 'dest-file.txt',
      };
      const action = moveFileOrDirectory({ clientId, agentId, sourcePath, moveFileDto: moveDto });
      const error = new Error('Move failed');
      const outcome = moveFileOrDirectoryFailure({
        clientId,
        agentId,
        sourcePath,
        error: 'Move failed',
        context: 'app',
      });

      actions$ = of(action);
      filesService.moveFileOrDirectory.mockReturnValue(throwError(() => error));

      moveFileOrDirectory$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('error normalization', () => {
    it('should normalize Error objects', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const error = new Error('Test error');
      const outcome = readFileFailure({ clientId, agentId, filePath, error: 'Test error', context: 'app' });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(throwError(() => error));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize string errors', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const error = 'String error';
      const outcome = readFileFailure({ clientId, agentId, filePath, error: 'String error', context: 'app' });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(throwError(() => error));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize object errors with message property', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const error = { message: 'Object error' };
      const outcome = readFileFailure({ clientId, agentId, filePath, error: 'Object error', context: 'app' });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(throwError(() => error));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should use default error message for unknown error types', (done) => {
      const filePath = 'test-file.txt';
      const action = readFile({ clientId, agentId, filePath });
      const error = { unknown: 'property' };
      const outcome = readFileFailure({
        clientId,
        agentId,
        filePath,
        error: 'An unexpected error occurred',
        context: 'app',
      });

      actions$ = of(action);
      filesService.readFile.mockReturnValue(throwError(() => error));

      readFile$(actions$, filesService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
