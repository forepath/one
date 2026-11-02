import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  FpcListEditorComponent,
  FpcListEditorItemDirective,
  fpcListMove,
  fpcListRemove,
} from './list-editor.component';

interface Disk {
  name: string;
  tags: string[];
}

@Component({
  standalone: true,
  imports: [FpcListEditorComponent, FpcListEditorItemDirective],
  template: `
    <fpc-list-editor
      class="outer"
      label="Disks"
      [(items)]="disks"
      [newItem]="newDisk"
      [itemLabel]="diskLabel"
      [min]="1"
      [max]="3"
    >
      <ng-template fpcListEditorItem let-disk let-i="index">
        <span class="disk-name">{{ disk.name }}</span>
        <!-- Nested list inside a row. -->
        <fpc-list-editor
          layout="inline"
          [ariaLabel]="'Tags of ' + disk.name"
          [items]="disk.tags"
          (itemsChange)="setTags(i, $event)"
          [newItem]="newTag"
        >
          <ng-template fpcListEditorItem let-tag>
            <span class="tag">{{ tag }}</span>
          </ng-template>
        </fpc-list-editor>
      </ng-template>
    </fpc-list-editor>
  `,
})
class HostComponent {
  readonly disks = signal<readonly Disk[]>([
    { name: 'root', tags: [] },
    { name: 'data', tags: ['fast'] },
  ]);
  readonly newDisk = (): Disk => ({ name: 'new', tags: [] });
  readonly newTag = () => 'tag';
  readonly diskLabel = (disk: Disk, index: number) => `Disk ${index + 1} · ${disk.name}`;

  setTags(index: number, tags: readonly string[]): void {
    this.disks.update((disks) => disks.map((d, i) => (i === index ? { ...d, tags: [...tags] } : d)));
  }
}

describe('FpcListEditorComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const outer = () => host.querySelector('fpc-list-editor.outer') as HTMLElement;
    const rows = () => Array.from(host.querySelectorAll('fpc-list-editor.outer > ol > li'));
    const click = (el: Element | null | undefined) => {
      (el as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    return { fixture, host, outer, rows, click };
  }

  it('moves and removes with pure helpers', () => {
    expect(fpcListMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(fpcListMove(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(fpcListRemove(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('renders labelled rows with accessible row actions', () => {
    const { outer, rows } = render();

    expect(outer().getAttribute('role')).toBe('group');
    expect(outer().textContent).toContain('Disks');
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Disk 1 · root', 'Disk 2 · data']);
    expect(rows()[0].querySelector('[data-testid="fpc-list-editor-up"]')?.getAttribute('aria-label')).toBe(
      'Move Disk 1 · root up',
    );
    expect((rows()[0].querySelector('[data-testid="fpc-list-editor-up"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds (factory), reorders and removes rows, bounded by min / max', () => {
    const { fixture, host, rows, click } = render();
    const add = () => host.querySelector('fpc-list-editor.outer > [data-testid="fpc-list-editor-add"]');

    click(add());
    expect(fixture.componentInstance.disks().map((d) => d.name)).toEqual(['root', 'data', 'new']);
    // max = 3
    expect((add() as HTMLButtonElement).disabled).toBe(true);

    click(rows()[2].querySelector('[data-testid="fpc-list-editor-up"]'));
    expect(fixture.componentInstance.disks().map((d) => d.name)).toEqual(['root', 'new', 'data']);

    click(rows()[0].querySelector('.fpc-list-editor__item-head [data-testid="fpc-list-editor-remove"]'));
    click(rows()[0].querySelector('.fpc-list-editor__item-head [data-testid="fpc-list-editor-remove"]'));
    expect(fixture.componentInstance.disks().map((d) => d.name)).toEqual(['data']);
    // min = 1
    expect(
      (
        rows()[0].querySelector(
          '.fpc-list-editor__item-head [data-testid="fpc-list-editor-remove"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('edits nested lists inside a row', () => {
    const { fixture, rows, click } = render();
    const inner = rows()[1].querySelector('fpc-list-editor') as HTMLElement;

    expect(inner.getAttribute('aria-label')).toBe('Tags of data');
    click(inner.querySelector('[data-testid="fpc-list-editor-add"]'));
    expect(fixture.componentInstance.disks()[1].tags).toEqual(['fast', 'tag']);

    click(rows()[1].querySelector('.fpc-list-editor--inline [data-testid="fpc-list-editor-remove"]'));
    expect(fixture.componentInstance.disks()[1].tags).toEqual(['tag']);
    expect(fixture.componentInstance.disks()[0].tags).toEqual([]);
  });
});
