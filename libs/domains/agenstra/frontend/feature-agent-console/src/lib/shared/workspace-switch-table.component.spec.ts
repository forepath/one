import { TestBed } from '@angular/core/testing';
import type { ClientResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';

import { WORKSPACE_SWITCH_ALL_ID, WorkspaceSwitchTableComponent } from './workspace-switch-table.component';

describe('WorkspaceSwitchTableComponent', () => {
  const clients = [
    { id: 'c1', name: 'Alpha' },
    { id: 'c2', name: 'Beta' },
  ] as ClientResponseDto[];

  function create(inputs: Record<string, unknown>) {
    const fixture = TestBed.configureTestingModule({ imports: [WorkspaceSwitchTableComponent] }).createComponent(
      WorkspaceSwitchTableComponent,
    );

    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);

    const component = fixture.componentInstance as unknown as {
      rows: () => ClientResponseDto[];
      activeRowId: () => string | null;
      onRowActivate: (row: ClientResponseDto) => void;
      query: { set: (value: string) => void };
      selectAll: { subscribe: (fn: () => void) => void };
      selectWorkspace: { subscribe: (fn: (row: ClientResponseDto) => void) => void };
    };

    return component;
  }

  it('lists only the workspaces without an all option (boards)', () => {
    const table = create({ clients, currentId: 'c2' });

    expect(table.rows().map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(table.activeRowId()).toBe('c2');
  });

  it('leads with "All workspaces", current when no workspace is selected', () => {
    const table = create({ clients, currentId: null, allOption: { label: 'All workspaces' } });
    const selectAll = jest.fn();
    const selectWorkspace = jest.fn();

    table.selectAll.subscribe(selectAll);
    table.selectWorkspace.subscribe(selectWorkspace);

    expect(table.rows().map((r) => r.id)).toEqual([WORKSPACE_SWITCH_ALL_ID, 'c1', 'c2']);
    expect(table.activeRowId()).toBe(WORKSPACE_SWITCH_ALL_ID);

    table.onRowActivate(table.rows()[0] as ClientResponseDto);
    table.onRowActivate(clients[1] as ClientResponseDto);

    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(selectWorkspace).toHaveBeenCalledWith(clients[1]);
  });

  it('hides the all option while searching', () => {
    const table = create({ clients, currentId: 'c1', allOption: { label: 'All workspaces' } });

    table.query.set('alp');

    expect(table.rows().map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(table.activeRowId()).toBe('c1');
  });
});
