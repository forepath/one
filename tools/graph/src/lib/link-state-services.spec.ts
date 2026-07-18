import { linkStateServices } from './link-state-services';
import { KnowledgeNode } from './schema';

describe('linkStateServices', () => {
  it('should link state to exact matching service in the same project', () => {
    const nodes: KnowledgeNode[] = [
      {
        id: 'file:libs/demo/src/lib/state/invoices',
        type: 'state',
        attrs: {
          path: 'libs/demo/src/lib/state/invoices',
          languageOrKind: 'ts',
          projectName: 'demo-feature',
          sliceName: 'invoices',
          memberFiles: ['invoices.actions.ts'],
        },
      },
      {
        id: 'file:libs/demo/src/lib/services/invoices.service.ts',
        type: 'service',
        attrs: {
          path: 'libs/demo/src/lib/services/invoices.service.ts',
          languageOrKind: 'ts',
          projectName: 'demo-feature',
        },
      },
      {
        id: 'file:libs/demo/src/lib/services/admin-invoices.service.ts',
        type: 'service',
        attrs: {
          path: 'libs/demo/src/lib/services/admin-invoices.service.ts',
          languageOrKind: 'ts',
          projectName: 'demo-feature',
        },
      },
      {
        id: 'file:libs/other/src/lib/services/invoices.service.ts',
        type: 'service',
        attrs: {
          path: 'libs/other/src/lib/services/invoices.service.ts',
          languageOrKind: 'ts',
          projectName: 'other',
        },
      },
    ];

    expect(linkStateServices(nodes)).toEqual([
      {
        from: 'file:libs/demo/src/lib/state/invoices',
        to: 'file:libs/demo/src/lib/services/invoices.service.ts',
        type: 'contains',
      },
    ]);
  });

  it('should emit no edge when no matching service exists', () => {
    const nodes: KnowledgeNode[] = [
      {
        id: 'file:libs/demo/src/lib/state/tickets-board-socket',
        type: 'state',
        attrs: {
          path: 'libs/demo/src/lib/state/tickets-board-socket',
          languageOrKind: 'ts',
          projectName: 'demo-feature',
          sliceName: 'tickets-board-socket',
        },
      },
    ];

    expect(linkStateServices(nodes)).toEqual([]);
  });
});
