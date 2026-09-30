import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcBadgeColor,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

import type { AgentChatDiffLineEmbed, AgentChatTodoStatus, AgentChatToolEmbedView } from './agent-chat-tool-embed-view';

type TodosEmbed = Extract<AgentChatToolEmbedView, { kind: 'todos' }>;
type BashEmbed = Extract<AgentChatToolEmbedView, { kind: 'bash' }>;
type ReadEmbed = Extract<AgentChatToolEmbedView, { kind: 'read' }>;
type GlobEmbed = Extract<AgentChatToolEmbedView, { kind: 'glob' }>;
type GrepEmbed = Extract<AgentChatToolEmbedView, { kind: 'grep' }>;
type EditEmbed = Extract<AgentChatToolEmbedView, { kind: 'edit' }>;
type WriteEmbed = Extract<AgentChatToolEmbedView, { kind: 'write' }>;
type PatchEmbed = Extract<AgentChatToolEmbedView, { kind: 'patch' }>;
type WebfetchEmbed = Extract<AgentChatToolEmbedView, { kind: 'webfetch' }>;
type WebsearchEmbed = Extract<AgentChatToolEmbedView, { kind: 'websearch' }>;
type TaskEmbed = Extract<AgentChatToolEmbedView, { kind: 'task' }>;
type SkillEmbed = Extract<AgentChatToolEmbedView, { kind: 'skill' }>;
type InvalidEmbed = Extract<AgentChatToolEmbedView, { kind: 'invalid' }>;

@Component({
  selector: 'framework-agent-chat-tool-embed',
  standalone: true,
  imports: [NgClass, FpcAlertComponent, FpcBadgeComponent, FpcListComponent, FpcListItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './agent-chat-tool-embed.component.scss',
  templateUrl: './agent-chat-tool-embed.component.html',
})
export class AgentChatToolEmbedComponent {
  readonly embed = input.required<AgentChatToolEmbedView>();

  protected readonly todosLabel = $localize`:@@featureChat-toolEmbedTodos:Todos`;
  protected readonly commandLabel = $localize`:@@featureChat-toolEmbedCommand:Command`;
  protected readonly workdirLabel = $localize`:@@featureChat-toolEmbedWorkdir:Working directory`;
  protected readonly outputLabel = $localize`:@@featureChat-toolEmbedOutput:Output`;
  protected readonly fileLabel = $localize`:@@featureChat-toolEmbedFile:File`;
  protected readonly matchesLabel = $localize`:@@featureChat-toolEmbedMatches:Matches`;
  protected readonly noMatchesLabel = $localize`:@@featureChat-toolEmbedNoMatches:No matches`;
  protected readonly editLabel = $localize`:@@featureChat-toolEmbedEdit:Edit`;
  protected readonly writeLabel = $localize`:@@featureChat-toolEmbedWrite:Write`;
  protected readonly contentLabel = $localize`:@@featureChat-toolEmbedContent:Content`;
  protected readonly diffLabel = $localize`:@@featureChat-toolEmbedDiff:Diff`;
  protected readonly patchLabel = $localize`:@@featureChat-toolEmbedPatch:Patch`;
  protected readonly fetchLabel = $localize`:@@featureChat-toolEmbedFetch:Fetch`;
  protected readonly searchLabel = $localize`:@@featureChat-toolEmbedSearch:Search`;
  protected readonly taskLabel = $localize`:@@featureChat-toolEmbedTask:Subagent`;
  protected readonly promptLabel = $localize`:@@featureChat-toolEmbedPrompt:Prompt`;
  protected readonly resultLabel = $localize`:@@featureChat-toolEmbedResult:Result`;
  protected readonly skillLabel = $localize`:@@featureChat-toolEmbedSkill:Skill`;
  protected readonly invalidLabel = $localize`:@@featureChat-toolEmbedInvalid:Invalid tool`;
  protected readonly truncatedLabel = $localize`:@@featureChat-toolEmbedTruncated:Output truncated for display`;
  protected readonly bashFailedLabel = $localize`:@@featureChat-toolEmbedBashFailed:Command reported an error`;
  protected readonly fetchFailedLabel = $localize`:@@featureChat-toolEmbedFetchFailed:Fetch reported an error`;
  protected readonly searchFailedLabel = $localize`:@@featureChat-toolEmbedSearchFailed:Search reported an error`;

  readonly embedAriaLabel = computed(() => {
    const kind = this.embed().kind;

    return $localize`:@@featureChat-toolEmbedAria:Tool result · ${kind}:toolKind:`;
  });

  asTodos(): TodosEmbed | null {
    const e = this.embed();

    return e.kind === 'todos' ? e : null;
  }

  asBash(): BashEmbed | null {
    const e = this.embed();

    return e.kind === 'bash' ? e : null;
  }

  asRead(): ReadEmbed | null {
    const e = this.embed();

    return e.kind === 'read' ? e : null;
  }

  asGlob(): GlobEmbed | null {
    const e = this.embed();

    return e.kind === 'glob' ? e : null;
  }

  asGrep(): GrepEmbed | null {
    const e = this.embed();

    return e.kind === 'grep' ? e : null;
  }

  asEdit(): EditEmbed | null {
    const e = this.embed();

    return e.kind === 'edit' ? e : null;
  }

  asWrite(): WriteEmbed | null {
    const e = this.embed();

    return e.kind === 'write' ? e : null;
  }

  asPatch(): PatchEmbed | null {
    const e = this.embed();

    return e.kind === 'patch' ? e : null;
  }

  asWebfetch(): WebfetchEmbed | null {
    const e = this.embed();

    return e.kind === 'webfetch' ? e : null;
  }

  asWebsearch(): WebsearchEmbed | null {
    const e = this.embed();

    return e.kind === 'websearch' ? e : null;
  }

  asTask(): TaskEmbed | null {
    const e = this.embed();

    return e.kind === 'task' ? e : null;
  }

  asSkill(): SkillEmbed | null {
    const e = this.embed();

    return e.kind === 'skill' ? e : null;
  }

  asInvalid(): InvalidEmbed | null {
    const e = this.embed();

    return e.kind === 'invalid' ? e : null;
  }

  todoStatusColor(status: AgentChatTodoStatus): FpcBadgeColor {
    switch (status) {
      case 'completed':
        return 'success';
      case 'in_progress':
        return 'info';
      case 'cancelled':
        return 'secondary';
      case 'pending':
        return 'warning';
      default:
        return 'light';
    }
  }

  todoStatusLabel(status: AgentChatTodoStatus): string {
    switch (status) {
      case 'completed':
        return $localize`:@@featureChat-toolEmbedTodoCompleted:Completed`;
      case 'in_progress':
        return $localize`:@@featureChat-toolEmbedTodoInProgress:In progress`;
      case 'cancelled':
        return $localize`:@@featureChat-toolEmbedTodoCancelled:Cancelled`;
      case 'pending':
        return $localize`:@@featureChat-toolEmbedTodoPending:Pending`;
      default:
        return $localize`:@@featureChat-toolEmbedTodoUnknown:Unknown`;
    }
  }

  showingOfLabel(shown: number, total: number): string {
    return $localize`:@@featureChat-toolEmbedShowingOf:Showing ${shown}:shown: of ${total}:total:`;
  }

  invalidMessage(tool: string, error: string): string {
    return $localize`:@@featureChat-toolEmbedInvalidMessage:${tool}:toolName: — ${error}:errorText:`;
  }

  asDiffLines(prefix: '+' | '-', text: string): AgentChatDiffLineEmbed[] {
    return text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => ({
        kind: prefix === '+' ? 'add' : 'remove',
        text: `${prefix}${line}`,
      }));
  }

  diffLineClass(line: AgentChatDiffLineEmbed): string {
    switch (line.kind) {
      case 'add':
        return 'agent-chat-tool-embed__diff-line--add';
      case 'remove':
        return 'agent-chat-tool-embed__diff-line--remove';
      case 'header':
        return 'agent-chat-tool-embed__diff-line--header';
      default:
        return 'agent-chat-tool-embed__diff-line--context';
    }
  }
}
