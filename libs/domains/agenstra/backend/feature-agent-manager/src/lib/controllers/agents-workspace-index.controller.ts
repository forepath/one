import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';
import { WorkspaceInotifySupervisor } from '../services/workspace-inotify-supervisor.service';

/**
 * Signals a workspace index rebuild (notifications only — no search on manager).
 */
@Controller('agents/:agentId/workspace-index')
export class AgentsWorkspaceIndexController {
  constructor(
    private readonly changeNotifier: WorkspaceChangeNotifierService,
    private readonly inotifySupervisor: WorkspaceInotifySupervisor,
  ) {}

  @Post('rebuild-signal')
  @HttpCode(HttpStatus.ACCEPTED)
  async rebuildSignal(
    @Param('agentId', new ParseUUIDPipe({ version: '4' })) agentId: string,
  ): Promise<{ accepted: true }> {
    await this.inotifySupervisor.startWatcher(agentId);
    this.changeNotifier.notifyRebuildRequired(agentId, 'manual-rebuild-signal');

    return { accepted: true };
  }
}
