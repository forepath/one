import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcTreeComponent, FpcTreeContextMenuEvent } from './tree.component';
import { FpcTreeNode } from './tree.model';

const nodes: FpcTreeNode[] = [
  {
    id: 'cluster',
    label: 'Cluster',
    icon: 'hdd-stack',
    status: 'success',
    statusLabel: 'Healthy',
    hint: 'Cluster · since 10/28/26 · quorum-lost: the control plane lost its quorum',
    badge: 3,
    children: [
      {
        id: 'site:a',
        label: 'Site A',
        mark: true,
        markLabel: 'Changed in the draft',
        children: [{ id: 'n1', label: 'n1' }],
      },
      { id: 'site:b', label: 'Site B', hasChildren: true },
    ],
  },
];

describe('FpcTreeComponent', () => {
  let fixture: ComponentFixture<FpcTreeComponent>;
  let host: HTMLElement;
  let tree: FpcTreeComponent;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcTreeComponent);
    host = fixture.nativeElement as HTMLElement;
    tree = fixture.componentInstance;
    fixture.componentRef.setInput('nodes', nodes);
    fixture.componentRef.setInput('ariaLabel', 'Resources');
    fixture.detectChanges();
  });

  function rows(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  function key(name: string, init: KeyboardEventInit = {}): void {
    host
      .querySelector('[role="tree"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init }));
    fixture.detectChanges();
  }

  it('renders roots with status, badge and ARIA attributes', () => {
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(row.getAttribute('aria-level')).toBe('1');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.fpc-tree__status--success')).not.toBeNull();
    expect(row.querySelector('.fpc-tree__badge')?.textContent?.trim()).toBe('3');
    // The truncated detail line keeps its full text as a tooltip.
    expect(row.querySelector('.fpc-tree__hint')?.getAttribute('title')).toBe(
      'Cluster · since 10/28/26 · quorum-lost: the control plane lost its quorum',
    );
  });

  it('expands via the twisty, selects on click and emits the activation', () => {
    const activated: string[] = [];
    tree.nodeActivate.subscribe((node) => activated.push(node.id));

    (rows()[0].querySelector('.fpc-tree__twisty') as HTMLElement).click();
    fixture.detectChanges();
    expect(tree.expanded()).toEqual(['cluster']);
    expect(rows()).toHaveLength(3);
    expect(rows()[1].querySelector('.fpc-tree__mark')).not.toBeNull();

    rows()[1].click();
    fixture.detectChanges();
    expect(tree.selectedId()).toBe('site:a');
    expect(activated).toEqual(['site:a']);
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('requests lazy children when a lazy node expands', () => {
    const requested: string[] = [];
    tree.expandRequest.subscribe((node) => requested.push(node.id));
    fixture.componentRef.setInput('expanded', ['cluster']);
    fixture.detectChanges();

    (rows()[2].querySelector('.fpc-tree__twisty') as HTMLElement).click();
    expect(requested).toEqual(['site:b']);
  });

  it('navigates with the keyboard', () => {
    const activated: string[] = [];
    tree.nodeActivate.subscribe((node) => activated.push(node.id));
    host.querySelector<HTMLElement>('[role="tree"]')!.dispatchEvent(new FocusEvent('focus'));

    key('ArrowRight'); // expand cluster
    expect(tree.expanded()).toEqual(['cluster']);
    key('ArrowRight'); // into site:a
    key('ArrowDown'); // site:b
    key('Enter');
    expect(activated).toEqual(['site:b']);
    key('ArrowLeft'); // to the parent
    key('ArrowLeft'); // collapse
    expect(tree.expanded()).toEqual([]);
    expect(host.querySelector('[role="tree"]')!.getAttribute('aria-activedescendant')).toContain('cluster');
  });

  it('emits context-menu requests on right click', () => {
    const events: FpcTreeContextMenuEvent[] = [];
    tree.nodeContextMenu.subscribe((event) => events.push(event));

    rows()[0].dispatchEvent(new MouseEvent('contextmenu', { clientX: 5, clientY: 6, bubbles: true, cancelable: true }));
    expect(events).toEqual([{ node: nodes[0], x: 5, y: 6 }]);
  });

  it('reveals a nested node by expanding its ancestors', () => {
    expect(tree.reveal('n1')).toBe(true);
    fixture.detectChanges();
    expect(tree.expanded()).toEqual(['cluster', 'site:a']);
    expect(tree.selectedId()).toBe('n1');
    expect(tree.reveal('missing')).toBe(false);
  });

  it('renders only a window of a long list', () => {
    const many: FpcTreeNode[] = Array.from({ length: 2000 }, (_, index) => ({
      id: `n${index}`,
      label: `Node ${index}`,
    }));
    fixture.componentRef.setInput('nodes', many);
    fixture.detectChanges();

    expect(rows().length).toBeLessThan(100);
    expect(rows()[0].getAttribute('aria-posinset')).toBe('1');
    expect(rows()[0].getAttribute('aria-setsize')).toBe('2000');
  });

  it('shows the empty text without nodes', () => {
    fixture.componentRef.setInput('nodes', []);
    fixture.componentRef.setInput('emptyText', 'No resources');
    fixture.detectChanges();
    expect(host.querySelector('.fpc-tree__empty')?.textContent).toContain('No resources');
  });
});
