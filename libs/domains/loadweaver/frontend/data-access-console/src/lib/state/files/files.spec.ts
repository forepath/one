import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { LiveFilesService } from '../../services/live-files.service';
import type { LiveFileEntry } from '../../types/live.types';
import {
  dismissFilesMessages,
  fileOperationFailure,
  fileOperationSuccess,
  openFilesDirectory,
  openFilesDirectoryFailure,
  openFilesDirectorySuccess,
  refreshFiles,
  runFileOperation,
  setFilesWarning,
} from './files.actions';
import { openFilesDirectory$, refreshFiles$, reloadAfterFileOperation$, runFileOperation$ } from './files.effects';
import { consoleFilesReducer, initialConsoleFilesState } from './files.reducer';

function entry(name: string, type: LiveFileEntry['type'] = 'file'): LiveFileEntry {
  return { name, type, size: 12, modifiedAt: '2026-10-18T09:00:00.000Z', mode: 0o644 };
}

const target = 'replica:shop/web/api/0' as const;

describe('console files state', () => {
  it('lists a directory, folders first, and ignores late answers of another directory', () => {
    let state = consoleFilesReducer(initialConsoleFilesState, openFilesDirectory({ target, path: '/etc' }));

    expect(state).toMatchObject({ target, path: '/etc', loading: true });
    expect(consoleFilesReducer(state, openFilesDirectorySuccess({ target, path: '/', entries: [entry('x')] }))).toBe(
      state,
    );
    state = consoleFilesReducer(
      state,
      openFilesDirectorySuccess({
        target,
        path: '/etc',
        entries: [entry('hosts'), entry('nginx', 'directory'), entry('a')],
      }),
    );
    expect(state.entries.map((e) => e.name)).toEqual(['nginx', 'a', 'hosts']);

    state = consoleFilesReducer(state, openFilesDirectory({ target: 'volume:shop/web/data', path: '/' }));
    expect(state.entries).toEqual([]);
    state = consoleFilesReducer(
      state,
      openFilesDirectoryFailure({ target: 'volume:shop/web/data', path: '/', error: 'not mounted' }),
    );
    expect(state).toMatchObject({ loading: false, error: 'not mounted' });
  });

  it('tracks operations, warnings and their dismissal', () => {
    let state = consoleFilesReducer(
      initialConsoleFilesState,
      runFileOperation({ target, operation: { kind: 'delete', path: '/tmp/x' } }),
    );

    expect(state.busy).toBe(true);
    state = consoleFilesReducer(
      state,
      fileOperationSuccess({ operation: { kind: 'delete', path: '/tmp/x' }, warning: 'lost on restart' }),
    );
    expect(state).toMatchObject({ busy: false, warning: 'lost on restart' });
    state = consoleFilesReducer(state, fileOperationFailure({ error: 'exists' }));
    expect(state.operationError).toBe('exists');
    state = consoleFilesReducer(state, setFilesWarning({ warning: null }));
    expect(state.warning).toBe('lost on restart');
    expect(consoleFilesReducer(state, dismissFilesMessages())).toMatchObject({ warning: null, operationError: null });
  });

  it('lists over the API and refreshes the current directory', async () => {
    const service = {
      list: jest
        .fn()
        .mockReturnValueOnce(of([entry('hosts')]))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'not found' } }))),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            openFilesDirectory({ target, path: '/etc' }),
            openFilesDirectory({ target, path: '/nope' }),
            refreshFiles(),
          ),
        ),
        provideMockStore({ initialState: { consoleFiles: { ...initialConsoleFilesState, target, path: '/etc' } } }),
        { provide: LiveFilesService, useValue: service },
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => openFilesDirectory$()).pipe(toArray()))).toEqual([
      openFilesDirectorySuccess({ target, path: '/etc', entries: [entry('hosts')] }),
      openFilesDirectoryFailure({ target, path: '/nope', error: 'not found' }),
    ]);
    expect(await firstValueFrom(TestBed.runInInjectionContext(() => refreshFiles$()).pipe(toArray()))).toEqual([
      openFilesDirectory({ target, path: '/etc' }),
    ]);
  });

  it('runs operations in order and reloads after them', async () => {
    const service = {
      create: jest.fn().mockReturnValue(of(null)),
      move: jest.fn().mockReturnValue(of('lost on restart')),
      copy: jest
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'exists' } }))),
      remove: jest.fn().mockReturnValue(of(null)),
    };
    const create = { kind: 'create', path: '/tmp/a', type: 'directory' } as const;
    const move = { kind: 'move', path: '/tmp/a', destination: '/tmp/b', overwrite: false } as const;
    const copy = { kind: 'copy', path: '/tmp/b', destination: '/tmp/c', overwrite: true } as const;
    const remove = { kind: 'delete', path: '/tmp/b' } as const;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            runFileOperation({ target, operation: create }),
            runFileOperation({ target, operation: move }),
            runFileOperation({ target, operation: copy }),
            runFileOperation({ target, operation: remove }),
            fileOperationSuccess({ operation: remove, warning: null }),
          ),
        ),
        { provide: LiveFilesService, useValue: service },
      ],
    });

    expect(await firstValueFrom(TestBed.runInInjectionContext(() => runFileOperation$()).pipe(toArray()))).toEqual([
      fileOperationSuccess({ operation: create, warning: null }),
      fileOperationSuccess({ operation: move, warning: 'lost on restart' }),
      fileOperationFailure({ error: 'exists' }),
      fileOperationSuccess({ operation: remove, warning: null }),
    ]);
    expect(service.create).toHaveBeenCalledWith(target, '/tmp/a', 'directory');
    expect(service.move).toHaveBeenCalledWith(target, '/tmp/a', '/tmp/b', false);
    expect(service.copy).toHaveBeenCalledWith(target, '/tmp/b', '/tmp/c', true);
    expect(service.remove).toHaveBeenCalledWith(target, '/tmp/b');
    expect(
      await firstValueFrom(TestBed.runInInjectionContext(() => reloadAfterFileOperation$()).pipe(toArray())),
    ).toEqual([refreshFiles()]);
  });
});
