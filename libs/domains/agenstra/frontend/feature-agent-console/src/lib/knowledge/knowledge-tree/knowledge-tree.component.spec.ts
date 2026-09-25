import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KnowledgeFacade, type KnowledgeNodeDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';

import { KnowledgeTreeClipboardService } from './knowledge-tree-clipboard.service';
import { KnowledgeTreeComponent } from './knowledge-tree.component';

describe('KnowledgeTreeComponent selection', () => {
  let fixture: ComponentFixture<KnowledgeTreeComponent>;
  let component: KnowledgeTreeComponent;
  let selectNodeSpy: jest.Mock;

  const knowledgeFacadeStub = {
    deleteNode: jest.fn(),
    duplicateNode: jest.fn(),
    updateNode: jest.fn(),
    uploadTextFiles: jest.fn(),
  };

  function sampleNode(overrides: Partial<KnowledgeNodeDto> = {}): KnowledgeNodeDto {
    return {
      id: 'node-1',
      shas: { short: 'abc1234', long: 'abc1234long' },
      clientId: 'client-1',
      nodeType: 'page',
      parentId: null,
      title: 'Page',
      sortOrder: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function seedTree(): void {
    component.nodes = [
      sampleNode({
        id: 'folder',
        nodeType: 'folder',
        title: 'Folder',
        children: [
          sampleNode({ id: 'a', title: 'A', parentId: 'folder' }),
          sampleNode({ id: 'b', title: 'B', parentId: 'folder' }),
        ],
      }),
      sampleNode({ id: 'page', title: 'Root page' }),
    ];
    component.expandedNodeIds.set(new Set(['folder']));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KnowledgeTreeComponent],
      providers: [
        { provide: KnowledgeFacade, useValue: knowledgeFacadeStub },
        { provide: Actions, useValue: new Subject() },
        KnowledgeTreeClipboardService,
      ],
    })
      .overrideComponent(KnowledgeTreeComponent, {
        set: {
          template: '<div class="knowledge-tree-host"></div>',
          imports: [],
          providers: [KnowledgeTreeClipboardService],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(KnowledgeTreeComponent);
    component = fixture.componentInstance;
    component.workspaceId = 'client-1';
    component.loading = false;
    seedTree();
    fixture.detectChanges();

    selectNodeSpy = jest.fn();
    component.selectNode.subscribe(selectNodeSpy);
  });

  it('plain page click selects and emits selectNode', () => {
    const node = component.findNodeById(component.nodes, 'a');

    expect(node).not.toBeNull();
    component.onNodeClick(node!, {
      stopPropagation: jest.fn(),
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);

    expect(component.isNodeSelected('a')).toBe(true);
    expect(selectNodeSpy).toHaveBeenCalledWith(node);
  });

  it('Ctrl+click toggles selection without opening the editor or expanding', () => {
    const a = component.findNodeById(component.nodes, 'a')!;
    const folder = component.findNodeById(component.nodes, 'folder')!;
    const expandedBefore = component.isExpanded(folder);

    component.onNodeClick(a, {
      stopPropagation: jest.fn(),
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);
    component.onNodeClick(folder, {
      stopPropagation: jest.fn(),
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    } as unknown as MouseEvent);

    expect(component.isNodeSelected('a')).toBe(true);
    expect(component.isNodeSelected('folder')).toBe(true);
    expect(selectNodeSpy).not.toHaveBeenCalled();
    expect(component.isExpanded(folder)).toBe(expandedBefore);
  });

  it('marks open editor page separately from multi-selection', () => {
    component.selectedNodeId = 'page';
    component.selectedIds.set(new Set(['a']));

    expect(component.isNodeOpen('page')).toBe(true);
    expect(component.isNodeSelected('page')).toBe(false);
    expect(component.isNodeSelected('a')).toBe(true);
  });

  it('marks clipboard copy and cut roots for row highlight', () => {
    component.clipboardService.setClipboard('copy', [
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);

    expect(component.isNodeClipboardCopy('page')).toBe(true);
    expect(component.isNodeClipboardCut('page')).toBe(false);
    expect(component.isNodeClipboardCopy('folder')).toBe(false);

    component.clipboardService.setClipboard('cut', [
      { id: 'folder', nodeType: 'folder', parentId: null, title: 'Folder' },
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);

    expect(component.isNodeClipboardCut('folder')).toBe(true);
    expect(component.isNodeClipboardCut('page')).toBe(true);
    expect(component.isNodeClipboardCopy('folder')).toBe(false);
    expect(component.isNodeClipboardCut('a')).toBe(false);
  });

  it('marks busy rows from mutatingIds input', () => {
    component.mutatingIds = new Set(['a']);

    expect(component.isNodeBusy('a')).toBe(true);
    expect(component.isNodeBusy('page')).toBe(false);
  });

  it('Delete hotkey opens confirm for topmost selection roots', () => {
    component.selectedIds.set(new Set(['folder', 'a', 'page']));
    component.onTreeKeydown({
      key: 'Delete',
      ctrlKey: false,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.deleteModalOpen()).toBe(true);
    expect(
      component
        .itemsToDelete()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['folder', 'page']);
  });

  it('Ctrl+C stores clipboard entries for paste', () => {
    component.selectedIds.set(new Set(['page']));
    component.onTreeKeydown({
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      preventDefault: jest.fn(),
      target: document.createElement('div'),
    } as unknown as KeyboardEvent);

    expect(component.clipboardService.clipboard()).toEqual({
      mode: 'copy',
      entries: [{ id: 'page', nodeType: 'page', parentId: null, title: 'Root page' }],
    });
  });

  it('Ctrl+X stores cut clipboard entries for move paste', () => {
    component.selectedIds.set(new Set(['folder', 'page']));
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
        { id: 'folder', nodeType: 'folder', parentId: null, title: 'Folder' },
        { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
      ],
    });
  });

  it('paste expands a collapsed target folder before enqueueing', () => {
    component.expandedNodeIds.set(new Set());
    component.selectedIds.set(new Set(['folder']));
    component.selectionAnchorId.set('folder');
    component.clipboardService.setClipboard('copy', [
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);

    const enqueueSpy = jest.spyOn(component.clipboardService, 'enqueuePaste');

    component.onTreePaste({
      clipboardData: null,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(component.expandedNodeIds().has('folder')).toBe(true);
    expect(enqueueSpy).toHaveBeenCalledWith('folder', expect.any(Function), expect.any(Function));
  });

  it('background click clears selection so paste targets workspace root', () => {
    component.selectedIds.set(new Set(['a']));
    component.selectionAnchorId.set('a');
    component.clipboardService.setClipboard('copy', [
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);

    const background = document.createElement('div');

    background.className = 'knowledge-tree-scroll';
    component.onTreeBackgroundClick({
      target: background,
      stopPropagation: jest.fn(),
    } as unknown as MouseEvent);

    expect(component.selectedIds().size).toBe(0);
    expect(component.selectionAnchorId()).toBeNull();

    const enqueueSpy = jest.spyOn(component.clipboardService, 'enqueuePaste');

    component.onTreePaste({
      clipboardData: null,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(enqueueSpy).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Function));
  });

  it('paste uploads OS clipboard files when internal clipboard is empty', () => {
    const uploadSpy = jest.spyOn(
      component as unknown as { uploadFilesToParent: (files: File[], parentId: string | null) => Promise<void> },
      'uploadFilesToParent',
    );
    const file = new File(['hello'], 'pasted.md', { type: 'text/markdown' });
    const dataTransfer = {
      files: {
        length: 1,
        0: file,
        [Symbol.iterator]: function* () {
          yield file;
        },
      } as unknown as FileList,
    };

    component.selectedIds.set(new Set(['folder']));
    component.selectionAnchorId.set('folder');
    component.onTreePaste({
      clipboardData: dataTransfer,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(uploadSpy).toHaveBeenCalledWith([file], 'folder');
  });

  it('paste prefers internal clipboard over OS files', () => {
    component.clipboardService.setClipboard('copy', [
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);
    const enqueueSpy = jest.spyOn(component.clipboardService, 'enqueuePaste');
    const uploadSpy = jest.spyOn(
      component as unknown as { uploadFilesToParent: (files: File[], parentId: string | null) => Promise<void> },
      'uploadFilesToParent',
    );
    const file = new File(['hello'], 'pasted.md', { type: 'text/markdown' });

    component.selectedIds.set(new Set(['folder']));
    component.selectionAnchorId.set('folder');
    component.onTreePaste({
      clipboardData: {
        files: {
          length: 1,
          0: file,
          [Symbol.iterator]: function* () {
            yield file;
          },
        } as unknown as FileList,
      },
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: document.createElement('div'),
    } as unknown as ClipboardEvent);

    expect(enqueueSpy).toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
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

    expect(component.deleteModalOpen()).toBe(false);
    expect(component.renameModalOpen()).toBe(false);
  });

  it('Ctrl+C with empty selection does not clear an existing clipboard', () => {
    component.clipboardService.setClipboard('copy', [
      { id: 'page', nodeType: 'page', parentId: null, title: 'Root page' },
    ]);
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
      entries: [{ id: 'page', nodeType: 'page', parentId: null, title: 'Root page' }],
    });
  });
});
