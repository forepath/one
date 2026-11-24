import {
  fpcSidebarNavEntries,
  fpcSidebarNavGroupActive,
  fpcSidebarNavLinkActive,
  type FpcSidebarNavGroup,
} from './sidebar-nav-groups';

interface Link {
  activePaths: string[];
  label: string;
}

const link = (path: string): Link => ({ activePaths: [path], label: path });
const group = (key: string, items: Link[]): FpcSidebarNavGroup<Link> => ({
  key,
  icon: 'bi-box',
  label: key,
  title: key,
  items,
});

describe('fpcSidebarNavEntries', () => {
  it('drops empty groups, inlines single links and keeps larger groups', () => {
    const entries = fpcSidebarNavEntries([
      group('overview', [link('/overview')]),
      group('finance', []),
      group('system', [link('/users'), link('/webhooks')]),
    ]);

    expect(entries.map((entry) => [entry.kind, entry.key])).toEqual([
      ['item', 'overview'],
      ['group', 'system'],
    ]);
    expect(entries[0]).toEqual(expect.objectContaining({ item: link('/overview') }));
  });
});

describe('fpcSidebarNavLinkActive / fpcSidebarNavGroupActive', () => {
  it('matches the path and its sub-pages, ignoring query and fragment', () => {
    expect(fpcSidebarNavLinkActive(link('/users'), '/users')).toBe(true);
    expect(fpcSidebarNavLinkActive(link('/users'), '/users/42?tab=a#x')).toBe(true);
    expect(fpcSidebarNavLinkActive(link('/users'), '/users-archive')).toBe(false);
    expect(fpcSidebarNavLinkActive(link('/users'), '/settings?next=/users')).toBe(false);
  });

  it('marks a group active when one of its links is', () => {
    const system = group('system', [link('/users'), link('/webhooks')]);

    expect(fpcSidebarNavGroupActive(system, '/webhooks/1')).toBe(true);
    expect(fpcSidebarNavGroupActive(system, '/updates')).toBe(false);
  });
});
