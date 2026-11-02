import {
  confirmationsNeeded,
  mergeRisk,
  parseVolumeId,
  volumeDeletionChanges,
  volumeDeletionIssues,
  volumeDeletionRisk,
  volumeDeletionsOf,
  volumeDeletionWarnings,
} from './volume-deletions.utils';

/** Volume deletions of an app uninstall with `dataPolicy: delete` (P1). */
describe('volume deletions (P1)', () => {
  const deleteWiki = { action: 'delete', kind: 'Deployment', name: 'wiki', project: 'shop' } as const;
  const placement = (id: string) => ({
    id,
    primaryNode: 'n1',
    syncReplicas: ['n2'],
    remoteReplicas: ['n3', 'n2'],
    sizeBytes: '2147483648',
  });

  it('parses volume ids', () => {
    expect(parseVolumeId('shop/wiki/pg_data.1')).toEqual({ project: 'shop', deployment: 'wiki', volume: 'pg_data.1' });
    expect(parseVolumeId('shop/wiki')).toBeNull();
    expect(parseVolumeId('shop/wiki/../x')).toBeNull();
    expect(parseVolumeId('Shop/wiki/data')).toBeNull();
  });

  it('deletes volumes only together with their deployment in the same plan', () => {
    expect(volumeDeletionIssues(['shop/wiki/data', 'shop/wiki/pgdata'], [deleteWiki])).toEqual([]);
    expect(volumeDeletionIssues(['shop/other/data'], [deleteWiki])).toEqual([
      'volume shop/other/data: volumes are deleted only together with their deployment (delete Deployment shop/other in the same plan)',
    ]);
    // A running (updated) deployment's volume is refused, as is a kept one.
    expect(
      volumeDeletionIssues(
        ['shop/wiki/data'],
        [{ action: 'update', kind: 'Deployment', name: 'wiki', project: 'shop' }],
      ),
    ).toHaveLength(1);
    expect(volumeDeletionIssues(['shop/wiki/data', 'shop/wiki/data', 'nope'], [deleteWiki])).toEqual([
      'volume shop/wiki/data is listed twice',
      'volume nope: not <project>/<deployment>/<volume>',
    ]);
  });

  it('lists the holders and the size; unknown volumes are missing', () => {
    expect(volumeDeletionChanges(['shop/wiki/data', 'shop/wiki/gone'], [placement('shop/wiki/data')])).toEqual({
      changes: [
        { action: 'delete-volume', volume: 'shop/wiki/data', nodes: ['n1', 'n2', 'n3'], sizeBytes: 2147483648 },
      ],
      missing: ['shop/wiki/gone'],
    });
  });

  it('warns per volume (backups kept), needs a confirm and marks the project risky', () => {
    const { changes } = volumeDeletionChanges(['shop/wiki/data'], [placement('shop/wiki/data')]);
    const warnings = volumeDeletionWarnings(changes);

    expect(warnings).toEqual([
      {
        level: 'warning',
        path: 'volumes',
        volume: 'shop/wiki/data',
        destructive: true,
        message:
          'deletes volume shop/wiki/data and its data on n1, n2, n3 once the plan is applied; backups are kept and follow their retention',
      },
    ]);
    expect(confirmationsNeeded(warnings)).toEqual({ pins: false, destructive: true });
    expect(confirmationsNeeded([{ pin: true }])).toEqual({ pins: true, destructive: false });
    expect(mergeRisk({ shop: ['exposed'] }, volumeDeletionRisk(changes))).toEqual({
      shop: ['exposed', 'deletes the data of volume shop/wiki/data'],
    });
  });

  it('reads the deletions back from a stored plan', () => {
    expect(
      volumeDeletionsOf([
        { action: 'move', replica: 'shop/wiki/web/0' },
        { action: 'delete-volume', volume: 'shop/wiki/data', nodes: ['n1'], sizeBytes: 1 },
        { action: 'delete-volume', volume: 'bad' },
      ]),
    ).toEqual([{ action: 'delete-volume', volume: 'shop/wiki/data', nodes: ['n1'], sizeBytes: 1 }]);
    expect(volumeDeletionsOf(null)).toEqual([]);
  });
});
