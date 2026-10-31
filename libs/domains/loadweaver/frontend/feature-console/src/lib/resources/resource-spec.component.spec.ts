jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('./monaco-stub'));

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type ConsoleResource,
  ConsoleResourcesFacade,
  resourceToYaml,
} from '@forepath/loadweaver/frontend/data-access-console';

import { ResourceModalService } from '../objects/resource-modal.service';
import { facadeStub } from '../testing';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import { LoadweaverResourceSpecComponent } from './resource-spec.component';

const deployment: ConsoleResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Deployment',
  metadata: { name: 'web', project: 'shop' },
  spec: { compose: 'services:\n  web:\n    image: nginx:1.27\n' },
};
const WEB = { kind: 'Deployment', name: 'web', project: 'shop' };

describe('LoadweaverResourceSpecComponent (read-only Spec tab, edit in the modal)', () => {
  function setup(editable: boolean, drafted: string | null) {
    const facade = facadeStub({ selected$: deployment, selectedLoading$: false, selectedError$: null }, ['open']);
    const store = {
      active: signal(drafted ? { id: 'd1', ops: [{ op: 'upsert', ...WEB, document: drafted }] } : null),
      revert: jest.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverResourceSpecComponent],
      providers: [
        { provide: ConsoleResourcesFacade, useValue: facade },
        { provide: WorkspaceDraftStore, useValue: store },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverResourceSpecComponent);

    fixture.componentRef.setInput('resourceKey', WEB);
    fixture.componentRef.setInput('editable', editable);
    fixture.detectChanges();

    return { fixture, facade, store, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the drafted version, Draft vs live, Undo in draft and opens the edit modal', async () => {
    const drafted = resourceToYaml(deployment).replace('nginx:1.27', 'nginx:1.29');
    const { fixture, facade, store, el } = setup(true, drafted);

    expect(facade['open']).toHaveBeenCalledWith(WEB);
    expect(fixture.componentInstance.text()).toContain('nginx:1.29');
    expect(fixture.componentInstance.liveText()).toContain('nginx:1.27');
    expect(el.querySelector('[data-testid="spec-in-draft"]')).not.toBeNull();

    fixture.componentInstance.compare.set(true);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="spec-live"]')).not.toBeNull();

    (el.querySelector('[data-testid="spec-edit"] button') as HTMLButtonElement).click();
    expect(TestBed.inject(ResourceModalService).request()).toEqual({ mode: 'edit', key: WEB });

    await fixture.componentInstance.revertDraft();
    expect(store.revert).toHaveBeenCalledWith(WEB);
  });

  it('is view-only without the edit right', () => {
    const { fixture, el } = setup(false, null);

    expect(fixture.componentInstance.text()).toContain('nginx:1.27');
    expect(el.querySelector('[data-testid="spec-edit"]')).toBeNull();
    expect(el.querySelector('[data-testid="spec-revert-draft"]')).toBeNull();
  });
});
