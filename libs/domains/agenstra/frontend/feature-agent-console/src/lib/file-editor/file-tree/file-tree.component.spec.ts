import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentsFacade,
  ClientsFacade,
  FilesFacade,
  FilesService,
  VcsFacade,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Actions } from '@ngrx/effects';
import { of, Subject } from 'rxjs';

import { FileTreeClipboardService } from './file-tree-clipboard.service';
import { FileTreeComponent } from './file-tree.component';

describe('FileTreeComponent selection', () => {
  let fixture: ComponentFixture<FileTreeComponent>;
  let component: FileTreeComponent;
  let fileSelectSpy: jest.Mock;
  let directoryExpandSpy: jest.Mock;

  const filesFacadeStub = {
    listDirectory: jest.fn(),
    getDirectoryListing$: jest.fn().mockReturnValue(of([])),
    isListingDirectory$: jest.fn().mockReturnValue(of(false)),
    getActiveMutationPaths$: jest.fn().mockReturnValue(of(new Set())),
    deleteFileOrDirectory: jest.fn(),
    createFileOrDirectory: jest.fn(),
    moveFileOrDirectory: jest.fn(),
    readFile: jest.fn(),
  };

  const vcsFacadeStub = {
    status$: of(null),
    currentBranch$: of(null),
    statusIndicator$: of(null),
    loadingStatus$: of(false),
    staging$: of(false),
    unstaging$: of(false),
    committing$: of(false),
    loadStatus: jest.fn(),
    branches$: of([]),
    loadingBranches$: of(false),
  };

  function seedTree(): void {
    component.treeNodes.set([
      {
        path: 'src',
        name: 'src',
        type: 'directory',
        expanded: true,
        children: [
          { path: 'src/a.ts', name: 'a.ts', type: 'file' },
          { path: 'src/b.ts', name: 'b.ts', type: 'file' },
        ],
      },
      { path: 'readme.md', name: 'readme.md', type: 'file' },
    ]);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileTreeComponent],
      providers: [
        { provide: FilesFacade, useValue: filesFacadeStub },
        { provide: FilesService, useValue: { readFile: jest.fn(), listDirectory: jest.fn() } },
        { provide: ENVIRONMENT, useValue: { controller: { restApiUrl: 'http://localhost' } } },
        { provide: ClientsFacade, useValue: { getClientById$: () => of(null) } },
        {
          provide: AgentsFacade,
          useValue: {
            getAgentById$: () => of(null),
            getAgentsByClientId$: () => of([]),
          },
        },
        { provide: VcsFacade, useValue: vcsFacadeStub },
        { provide: Actions, useValue: new Subject() },
        FileTreeClipboardService,
      ],
    })
      .overrideComponent(FileTreeComponent, {
        set: {
          template: '<div class="file-tree-host"></div>',
          imports: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(FileTreeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('agentId', 'agent-1');
    fixture.componentRef.setInput('expandedPaths', new Set(['src']));
    fixture.componentRef.setInput('selectedPath', null);
    fixture.detectChanges();

    // Effects rebuild from cache; seed after CD so selection tests see nodes.
    seedTree();

    fileSelectSpy = jest.fn();
    directoryExpandSpy = jest.fn();
    component.fileSelect.subscribe(fileSelectSpy);
    component.directoryExpand.subscribe(directoryExpandSpy);
  });

  it('plain file click selects and emits fileSelect', () => {
    const node = component.findNodeByPath('src/a.ts');

    expect(node).not.toBeNull();
    component.onFileClick(node!, {
      stopPropagation: jest.fn(),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);

    expect(component.isPathSelected('src/a.ts')).toBe(true);
    expect(fileSelectSpy).toHaveBeenCalledWith('src/a.ts');
  });

  it('Ctrl+click toggles selection without opening the file or expanding', () => {
    const a = component.findNodeByPath('src/a.ts')!;
    const folder = component.findNodeByPath('src')!;

    component.onFileClick(a, {
      stopPropagation: jest.fn(),
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);
    component.onFileClick(folder, {
      stopPropagation: jest.fn(),
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);

    expect(component.isPathSelected('src/a.ts')).toBe(true);
    expect(component.isPathSelected('src')).toBe(true);
    expect(fileSelectSpy).not.toHaveBeenCalled();
    expect(directoryExpandSpy).not.toHaveBeenCalled();
  });

  it('marks open editor path separately from multi-selection', () => {
    fixture.componentRef.setInput('selectedPath', 'readme.md');
    component.selectedPaths.set(new Set(['src/a.ts']));

    expect(component.isPathOpen('readme.md')).toBe(true);
    expect(component.isPathSelected('readme.md')).toBe(false);
    expect(component.isPathSelected('src/a.ts')).toBe(true);
  });

  it('marks clipboard copy and cut roots for row highlight', () => {
    component.clipboardService.setClipboard('copy', [{ path: 'readme.md', type: 'file' }]);

    expect(component.isPathClipboardCopy('readme.md')).toBe(true);
    expect(component.isPathClipboardCut('readme.md')).toBe(false);
    expect(component.isPathClipboardCopy('src')).toBe(false);

    component.clipboardService.setClipboard('cut', [
      { path: 'src', type: 'directory' },
      { path: 'readme.md', type: 'file' },
    ]);

    expect(component.isPathClipboardCut('src')).toBe(true);
    expect(component.isPathClipboardCut('readme.md')).toBe(true);
    expect(component.isPathClipboardCopy('src')).toBe(false);
    expect(component.isPathClipboardCut('src/a.ts')).toBe(false);
  });

  it('Delete hotkey opens confirm for topmost selection roots', () => {
    component.selectedPaths.set(new Set(['src', 'src/a.ts', 'readme.md']));
    component.onTreeKeydown({
      key: 'Delete',
      ctrlKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.deleteFileModalOpen()).toBe(true);
    expect(
      component
        .itemsToDelete()
        .map((item) => item.path)
        .sort(),
    ).toEqual(['readme.md', 'src']);
  });

  it('Ctrl+C stores clipboard entries for paste', () => {
    component.selectedPaths.set(new Set(['readme.md']));
    component.onTreeKeydown({
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.clipboardService.clipboard()).toEqual({
      mode: 'copy',
      entries: [{ path: 'readme.md', type: 'file' }],
    });
  });

  it('Ctrl+X stores cut clipboard entries for move paste', () => {
    component.selectedPaths.set(new Set(['src', 'readme.md']));
    component.onTreeKeydown({
      key: 'x',
      ctrlKey: true,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.clipboardService.clipboard()).toEqual({
      mode: 'cut',
      entries: [
        { path: 'src', type: 'directory' },
        { path: 'readme.md', type: 'file' },
      ],
    });
  });

  it('paste expands a collapsed target folder before enqueueing', () => {
    fixture.componentRef.setInput('expandedPaths', new Set());
    component.selectedPaths.set(new Set(['src']));
    component.selectionAnchorPath.set('src');
    component.clipboardService.setClipboard('copy', [{ path: 'readme.md', type: 'file' }]);

    const enqueueSpy = jest.spyOn(component.clipboardService, 'enqueuePaste');

    component.onTreePaste({
      clipboardData: null,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(directoryExpandSpy).toHaveBeenCalledWith('src');
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', agentId: 'agent-1' }),
      'src',
      expect.any(Function),
    );
  });

  it('background click clears selection so paste targets workspace root', () => {
    component.selectedPaths.set(new Set(['src/a.ts']));
    component.selectionAnchorPath.set('src/a.ts');
    component.clipboardService.setClipboard('copy', [{ path: 'readme.md', type: 'file' }]);

    const background = document.createElement('div');

    background.className = 'file-tree-content';
    component.onTreeBackgroundClick({
      target: background,
      stopPropagation: jest.fn(),
    } as unknown as MouseEvent);

    expect(component.selectedPaths().size).toBe(0);
    expect(component.selectionAnchorPath()).toBeNull();

    const enqueueSpy = jest.spyOn(component.clipboardService, 'enqueuePaste');

    component.onTreePaste({
      clipboardData: null,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', agentId: 'agent-1' }),
      '.',
      expect.any(Function),
    );
  });

  it('paste uploads OS clipboard files into the paste target', () => {
    const uploadSpy = jest.spyOn(
      component as unknown as { uploadFilesToPath: (files: File[], path: string) => void },
      'uploadFilesToPath',
    );
    const file = new File(['hello'], 'pasted.txt', { type: 'text/plain' });
    const dataTransfer = {
      files: {
        length: 1,
        0: file,
        [Symbol.iterator]: function* () {
          yield file;
        },
      } as unknown as FileList,
      items: null,
    };

    component.selectedPaths.set(new Set(['src']));
    component.selectionAnchorPath.set('src');
    component.onTreePaste({
      clipboardData: dataTransfer,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(uploadSpy).toHaveBeenCalledWith([file], 'src');
  });

  it('Delete and F2 do nothing when nothing is selected', () => {
    component.clearTreeSelection();
    component.onTreeKeydown({
      key: 'Delete',
      ctrlKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);
    component.onTreeKeydown({
      key: 'F2',
      ctrlKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.deleteFileModalOpen()).toBe(false);
    expect(component.renameFileModalOpen()).toBe(false);
  });

  it('Ctrl+C with empty selection does not clear an existing clipboard', () => {
    component.clipboardService.setClipboard('copy', [{ path: 'readme.md', type: 'file' }]);
    component.clearTreeSelection();
    component.onTreeKeydown({
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.clipboardService.clipboard()).toEqual({
      mode: 'copy',
      entries: [{ path: 'readme.md', type: 'file' }],
    });
  });
});
