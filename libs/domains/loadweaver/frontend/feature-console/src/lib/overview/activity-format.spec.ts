import { activityKindLabel, activityLink, activityText, inboxItemTitle } from './activity-format';

const PLAN = '347168b8-b4bc-4021-a125-74482a65a202';

describe('activity feed text (D7 / D11, LW-03 / LW-04)', () => {
  it('shows plan events without their id and links the plan', () => {
    const item = { kind: 'plan', entity: PLAN, message: `plan ${PLAN} applied` };

    expect(activityText(item, 'en-US')).toBe('Plan applied');
    expect(activityText({ ...item, message: `plan ${PLAN} rolled-back: node n1 failed` }, 'en-US')).toBe(
      'Plan rolled back: node n1 failed',
    );
    expect(activityText(item, 'en-US')).not.toContain(PLAN);
    expect(activityLink(item)).toBe(`/activity/plans/${PLAN}`);
    expect(activityKindLabel('plan')).toBe('Plan');
  });

  it('names health entities by kind + name, translated states, no reason / timestamp text', () => {
    expect(
      activityText(
        {
          kind: 'health',
          entity: 'node/lw-devnode-3',
          message:
            'node/lw-devnode-3: healthy → failed (node lw-devnode-3 is not reachable (last seen 2026-10-28T12:47:40.270Z))',
        },
        'en-US',
      ),
    ).toBe('Node lw-devnode-3: Healthy → Failed');
    // The cluster's kind once, not "cluster cluster".
    expect(activityText({ kind: 'health', entity: 'cluster', message: 'cluster: new → degraded' }, 'en-US')).toBe(
      'Cluster: new → Degraded',
    );
    expect(activityLink({ kind: 'health', entity: 'site/default' })).toBe('/observe/health/site/default');
  });

  it('keeps other events, with instants in the locale format', () => {
    const text = activityText({ kind: 'drift', entity: 'x', message: 'changed at 2026-10-28T12:47:40.270Z' }, 'en-US');

    expect(text).not.toContain('T12:47');
    expect(text).toMatch(/^changed at 10\/28\/26, \d{1,2}:47\s[AP]M$/u);
    expect(activityLink({ kind: 'drift', entity: 'x' })).toBeNull();
    expect(activityKindLabel('something-new')).toBe('something-new');
  });
});

describe('inboxItemTitle (LW-19)', () => {
  it('names health items by their entity and reads the reason as a sentence', () => {
    expect(
      inboxItemTitle({
        kind: 'health',
        title: 'cluster cluster: the control plane lost its quorum (1 of 3 up)',
        link: '/clusters/7680708a-a67e-418c-b501-d6cbf9a2aed6/observe/health/cluster/cluster',
      }),
    ).toBe('Cluster: The control plane lost its quorum (1 of 3 members up)');
    expect(
      inboxItemTitle({ kind: 'health', title: 'site fra1: node n1 is down', link: '/observe/health/site/fra1' }),
    ).toBe('Site fra1: Node n1 is down');
  });

  it('starts other titles with a capital letter', () => {
    expect(inboxItemTitle({ kind: 'alert', title: 'disk almost full', link: '/observe/alerts/a' })).toBe(
      'Disk almost full',
    );
  });
});

describe('inboxItemTitle policy requests (X-02 round 2: no "(s)")', () => {
  it('uses real plural forms for old and new server titles', () => {
    const item = (title: string) => ({ kind: 'cross-project-request', title, link: '/access/requests/shop' });

    expect(inboxItemTitle(item('1 policy request(s) from other projects wait for shop'))).toBe(
      '1 policy request from another project waits for shop',
    );
    expect(inboxItemTitle(item('3 policy requests from other projects wait for shop'))).toBe(
      '3 policy requests from other projects wait for shop',
    );
  });
});
