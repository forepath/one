import { withoutFormatOfEmpty } from './resource-modal.component';
import { TestBed } from '@angular/core/testing';

import {
  createProjectFromUrl,
  isCreatableKind,
  NON_CREATABLE_KINDS,
  ResourceModalService,
} from './resource-modal.service';

describe('creatable kinds (user, 2026-10-29: no Cluster from inside a cluster)', () => {
  it('excludes the Cluster and keeps every other kind', () => {
    expect(NON_CREATABLE_KINDS.has('Cluster')).toBe(true);
    expect(isCreatableKind('Cluster')).toBe(false);
    expect(isCreatableKind('Deployment')).toBe(true);
    expect(isCreatableKind('Site')).toBe(true);
  });

  it('a Cluster preset (e.g. /create/Cluster) opens on the kind table instead', () => {
    const service = TestBed.inject(ResourceModalService);

    service.openCreate('Cluster', null);
    expect(service.request()).toEqual({ mode: 'create', kind: null, project: null });

    service.openCreate('Deployment', 'shop');
    expect(service.request()).toEqual({ mode: 'create', kind: 'Deployment', project: 'shop' });
  });
});

describe('top-bar create project preset (2026-10-29: the only create entry)', () => {
  it('takes the project of the current page or section', () => {
    expect(createProjectFromUrl('/resources/project/shop?tab=contents')).toBe('shop');
    expect(createProjectFromUrl('/resources/deployment/shop/web')).toBe('shop');
    expect(createProjectFromUrl('/resources/dnsrecord/-/mail')).toBeNull();
    expect(createProjectFromUrl('/resources/cluster')).toBeNull();
    expect(createProjectFromUrl('/operate/backups?project=blog')).toBe('blog');
    expect(createProjectFromUrl('/observe/alerts')).toBeNull();
  });
  it('reports an empty required text once, as Required (not also as an invalid format)', () => {
    const issues = withoutFormatOfEmpty([
      { path: ['spec', 'remoteAccess', 'endpoint'], message: 'must not be empty' },
      { path: ['spec', 'remoteAccess', 'endpoint'], message: 'must match ^[a-z]+$' },
      { path: ['spec', 'remoteAccess', 'pool'], message: 'must match ^[a-z]+$' },
    ]);

    expect(issues.map((i) => `${i.path.at(-1)}: ${i.message}`)).toEqual([
      'endpoint: must not be empty',
      'pool: must match ^[a-z]+$',
    ]);
  });
});
