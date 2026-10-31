jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'));

import { TestBed } from '@angular/core/testing';
import { resourceJsonSchema } from '@forepath/loadweaver/shared/util-model';

import { formSpec } from './schema-form';
import { LoadweaverSchemaFormComponent } from './schema-form.component';

const VM = [
  'apiVersion: loadweaver.com/v1',
  'kind: VirtualMachine',
  'metadata:',
  '  name: vm',
  '  project: shop',
  'spec:',
  '  image: registry.lw/shop/debian:13',
  '  cpu:',
  '    vcpus: 2',
  '  memory: 4Gi',
  '  disks:',
  '    - name: root',
  '      size: 20Gi',
  '  nics:',
  '    - name: eth0',
  '      groups: [web]',
  '',
].join('\n');

describe('LoadweaverSchemaFormComponent (generated form of a step, 2026-10-29)', () => {
  function render(keys: string[], text = VM, kind = 'VirtualMachine', live: string | null = null) {
    const fixture = TestBed.createComponent(LoadweaverSchemaFormComponent);

    fixture.componentRef.setInput('schema', resourceJsonSchema(kind as never));
    fixture.componentRef.setInput('keys', keys);
    fixture.componentRef.setInput('kindName', kind);
    fixture.componentRef.setInput('live', live);
    fixture.componentInstance.text.set(text);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const spec = () => formSpec(fixture.componentInstance.text()) as Record<string, unknown>;
    const click = (el: Element | null | undefined) => {
      (el as HTMLElement).click();
      fixture.detectChanges();
    };
    const type = (el: Element | null | undefined, value: string) => {
      const input = el as HTMLInputElement | HTMLSelectElement;

      input.value = value;
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
      fixture.detectChanges();
    };

    return { fixture, host, spec, click, type };
  }

  it('edits lists of objects: add (prefilled), reorder, remove, nested lists inside rows', () => {
    const { fixture, host, spec, click, type } = render(['disks', 'nics']);
    const disks = () => host.querySelector('[data-testid="schema-list-disks"]') as HTMLElement;
    const rows = () => Array.from(host.querySelectorAll('[data-testid="schema-list-disks"] > ol > li'));

    expect(disks().textContent).toContain('Disks');
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Disk 1 · root']);

    click(disks().querySelector('[data-testid="fpc-list-editor-add"]'));
    // A new disk with the required size prefilled; the name is still required.
    expect(spec()['disks']).toEqual([{ name: 'root', size: '20Gi' }, { size: '1Gi' }]);
    // The document's problems show at their fields, in words.
    fixture.componentRef.setInput('issues', [{ path: ['disks', 1], message: 'missing property "name"' }]);
    fixture.detectChanges();
    expect(rows()[1].querySelector('.invalid-feedback')?.textContent).toContain('Required');

    type(rows()[1].querySelector('input[id$="disks-1-name"]'), 'data');
    expect((spec()['disks'] as { name: string }[])[1].name).toBe('data');

    click(rows()[1].querySelector('[data-testid="fpc-list-editor-up"]'));
    expect((spec()['disks'] as { name: string }[]).map((d) => d.name)).toEqual(['data', 'root']);

    click(rows()[0].querySelector('.fpc-list-editor__item-head [data-testid="fpc-list-editor-remove"]'));
    expect((spec()['disks'] as { name: string }[]).map((d) => d.name)).toEqual(['root']);

    // A list inside a list row: the NIC's groups.
    const groups = host.querySelector('[data-testid="schema-list-nics.0.groups"]') as HTMLElement;

    click(groups.querySelector('[data-testid="fpc-list-editor-add"]'));
    type(groups.querySelectorAll('input')[1], 'db');
    expect((spec()['nics'] as { groups: string[] }[])[0].groups).toEqual(['web', 'db']);
  });

  it('edits quantities and enums with readable units and options', () => {
    const { host, spec, type } = render(['memory', 'firmware']);
    const unit = host.querySelector('select[id$="memory-unit"]') as HTMLSelectElement;

    expect(Array.from(unit.options).map((o) => o.textContent?.trim())).toEqual(['MiB', 'GiB', 'TiB']);
    type(host.querySelector('input[id$="-memory"]'), '512');
    type(unit, 'Mi');
    expect(spec()['memory']).toBe('512Mi');

    const firmware = host.querySelector('select[id$="-firmware"]') as HTMLSelectElement;

    expect(Array.from(firmware.options).map((o) => o.textContent?.trim())).toEqual(['Default: UEFI', 'UEFI', 'BIOS']);
    type(firmware, '1');
    expect(spec()['firmware']).toBe('bios');
  });

  it('edits key / value maps and unions (kind of entry)', async () => {
    const policy = [
      'apiVersion: loadweaver.com/v1',
      'kind: Policy',
      'metadata:',
      '  name: p',
      'spec:',
      '  from:',
      '    - builtin: internet',
      '',
    ].join('\n');
    const { fixture, host, spec, type, click } = render(['from'], policy, 'Policy');

    // ngModel writes the select value asynchronously.
    await fixture.whenStable();
    fixture.detectChanges();
    const variant = host.querySelector('[data-testid="schema-field-variant"] select') as HTMLSelectElement;

    expect(Array.from(variant.options).map((o) => o.textContent?.trim())).toEqual([
      'Group',
      'Built-in group',
      'Site',
      'Selector',
      'Network (CIDR)',
      'Host name',
      'Remote clients',
    ]);
    expect(variant.value).toBe('1');
    type(variant, '3');
    expect(spec()['from']).toEqual([{ selector: {} }]);

    const labels = host.querySelector('[data-testid="schema-map-from.0.selector.matchLabels"]') as HTMLElement;

    click(labels.querySelector('[data-testid="fpc-map-editor-add"]'));
    type(labels.querySelector('[data-testid="fpc-map-editor-key"]'), 'app');
    type(labels.querySelector('[data-testid="fpc-map-editor-value"]'), 'web');
    expect(spec()['from']).toEqual([{ selector: { matchLabels: { app: 'web' } } }]);
  });

  it('marks fields that differ from live and reverts one', () => {
    const live = VM.replace('memory: 4Gi', 'memory: 2Gi');
    const { host, spec, click } = render(['memory', 'image'], VM, 'VirtualMachine', live);
    const memory = host.querySelector('[data-field="memory"]') as HTMLElement;

    expect(memory.getAttribute('data-change')).toBe('changed');
    expect(memory.textContent).toContain('Live: 2 GiB');
    expect(host.querySelector('[data-field="image"]')?.getAttribute('data-change')).toBeNull();

    click(memory.querySelector('[data-testid="spec-field-revert"] button'));
    expect(spec()['memory']).toBe('2Gi');
  });
});
