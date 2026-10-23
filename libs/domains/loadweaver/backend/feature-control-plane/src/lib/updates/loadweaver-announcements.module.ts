import { getUserFromRequest, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { clusterSpecSchema } from '@forepath/loadweaver/shared/util-model';
import {
  INSTANCE_SCOPE_KEY,
  UpdateCheckService,
  UpdatesModule,
  UpdatesQueryService,
  type UpdateChannel,
} from '@forepath/shared/backend';
import { ForbiddenException, Injectable, Logger, Module } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ResourceEntity } from '../entities/resource.entity';
import { LOADWEAVER_QUEUE_NAME } from '../notifications/loadweaver-notification.events';
import {
  LoadweaverNotificationPublisher,
  LoadweaverNotificationsModule,
} from '../notifications/loadweaver-notifications.module';
import { ControlPlaneModule } from '../modules/control-plane.module';
import { ReleasesService } from './releases.service';

let channelRef: (() => Promise<UpdateChannel>) | null = null;
let publisherRef: LoadweaverNotificationPublisher | null = null;

/** The shared updates feature's admin routes (`/updates/announcements`): global admins and the API key. */
function assertAnnouncementsAdmin(req: unknown): void {
  const info = getUserFromRequest(req as RequestWithUser);
  const pat = (info.amr ?? []).includes('pat');

  if (info.isApiKeyAuth || (info.userRole === UserRole.ADMIN && !pat)) return;

  throw new ForbiddenException('Missing cluster permission');
}

/**
 * Release announcements (3.26) through the shared updates feature: GitHub releases of the cluster's channel
 * (`Cluster.spec.updates.channel`, beta = prereleases), the Loadweaver changelog scope, the instance heartbeat.
 */
export const loadweaverUpdatesModule = UpdatesModule.register({
  applicationId: 'loadweaver',
  productScope: 'loadweaver',
  serviceName: 'control-plane',
  controllerPath: 'updates/announcements',
  queueName: LOADWEAVER_QUEUE_NAME,
  resolveScopeKey: () => INSTANCE_SCOPE_KEY,
  assertAdmin: assertAnnouncementsAdmin,
  resolveChannel: async () => (channelRef ? await channelRef() : 'stable'),
  publishNotification: (type, data) => {
    if (type === 'application.update_available')
      void publisherRef?.publish('update.available', data).catch(() => undefined);
  },
});

/** Runs the shared check and records the announced release as a Loadweaver release (`announced`). */
@Injectable()
export class LoadweaverAnnouncementsService {
  private readonly logger = new Logger(LoadweaverAnnouncementsService.name);

  constructor(
    private readonly check: UpdateCheckService,
    private readonly query: UpdatesQueryService,
    private readonly releases: ReleasesService,
  ) {}

  async run(): Promise<void> {
    await this.check.runCheck();

    const { release } = await this.query.getFullState();

    if (!release) return;

    await this.releases.recordAnnouncement({
      tagName: release.tagName,
      name: release.name,
      htmlUrl: release.htmlUrl,
      publishedAt: release.publishedAt,
      changelog: [...release.scopedChangelog.product, ...release.scopedChangelog.shared].map((e) => e.text),
      prerelease: release.prerelease,
    });
    this.logger.log(`Release ${release.tagName} announced`);
  }
}

@Injectable()
class ChannelResolver {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async channel(): Promise<UpdateChannel> {
    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const parsed = clusterSpecSchema.safeParse(cluster?.spec);

    return parsed.success ? (parsed.data.updates?.channel ?? 'stable') : 'stable';
  }
}

@Module({
  imports: [ControlPlaneModule, LoadweaverNotificationsModule, loadweaverUpdatesModule],
  providers: [
    ChannelResolver,
    LoadweaverAnnouncementsService,
    {
      provide: 'LOADWEAVER_UPDATES_WIRE',
      useFactory: (resolver: ChannelResolver, publisher: LoadweaverNotificationPublisher) => {
        channelRef = () => resolver.channel();
        publisherRef = publisher;

        return true;
      },
      inject: [ChannelResolver, LoadweaverNotificationPublisher],
    },
  ],
  exports: [LoadweaverAnnouncementsService, loadweaverUpdatesModule],
})
export class LoadweaverAnnouncementsModule {}
