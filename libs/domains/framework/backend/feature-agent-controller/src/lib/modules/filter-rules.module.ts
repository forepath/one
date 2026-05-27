import { ClientEntity } from '@forepath/identity/backend';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FilterRulesController } from '../controllers/filter-rules.controller';
import { AgentConsoleRegexFilterRuleClientEntity } from '../entities/agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleSyncTargetEntity } from '../entities/agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';
import { AgentManagerFilterRulesClientService } from '../services/agent-manager-filter-rules-client.service';
import { FilterRulesSyncService } from '../services/filter-rules-sync.service';
import { FilterRulesService } from '../services/filter-rules.service';

import { ClientsModule } from './clients.module';

/**
 * Admin filter rules + background sync to agent-manager instances.
 * Imported with forwardRef from {@link ClientsModule} to avoid a provider cycle
 * (AgentManagerFilterRulesClientService uses {@link ClientsService}).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentConsoleRegexFilterRuleEntity,
      AgentConsoleRegexFilterRuleClientEntity,
      AgentConsoleRegexFilterRuleSyncTargetEntity,
      ClientEntity,
    ]),
    forwardRef(() => ClientsModule),
  ],
  controllers: [FilterRulesController],
  providers: [AgentManagerFilterRulesClientService, FilterRulesService, FilterRulesSyncService],
  exports: [FilterRulesService, FilterRulesSyncService],
})
export class FilterRulesModule {}
