import { VM_POWER_ACTIONS, type AgentEvent } from '@forepath/loadweaver/shared/util-agent-protocol';
import { VM_DEPLOYMENT_NAME } from '@forepath/loadweaver/shared/util-model';
import { In, type EntityManager } from 'typeorm';

import { VmCommandEntity, type VmCommandStatus, type VmCommandType } from '../entities/virtual-machine.entities';

/**
 * Outcomes of VM node commands (3.35): the agent has no result message for `vmPower` / `vmImageImport`, it reports
 * them as `event`s (source `storage`, labels `kind: virtual-machine`, `replica`, `result: running | done | failed`).
 * Current agents name the command explicitly (`vmCommand: { type, action?, importId? }`, F3b); older ones only label
 * `action` (power, on success) / `import` (re-image) and carry `<type> failed: <reason>` as the failure message —
 * the fallback. They are folded back into the queued `lw_vm_commands` rows: sent → running → succeeded / failed.
 */
export interface VmCommandOutcome {
  type: VmCommandType;
  project: string;
  name: string;
  /** `vmPower` action (successful power events only). */
  action?: string;
  /** `vmImageImport` id. */
  import?: string;
  status: Extract<VmCommandStatus, 'running' | 'succeeded' | 'failed'>;
  /** The agent's message for failures. */
  error: string | null;
}

const REPLICA = new RegExp(`^([a-z0-9-]+)/${VM_DEPLOYMENT_NAME}/([a-z0-9-]+)/0$`);
const RESULTS: Record<string, VmCommandOutcome['status']> = { running: 'running', done: 'succeeded', failed: 'failed' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The explicit command fields of a current agent, when they are valid (anything else falls back to the labels). */
function explicitCommand(
  vmCommand: AgentEvent['vmCommand'],
): Pick<VmCommandOutcome, 'type' | 'action' | 'import'> | null {
  if (vmCommand?.type === 'vmPower')
    return {
      type: 'vmPower',
      ...(vmCommand.action && (VM_POWER_ACTIONS as readonly string[]).includes(vmCommand.action)
        ? { action: vmCommand.action }
        : {}),
    };

  if (vmCommand?.type === 'vmImageImport')
    return {
      type: 'vmImageImport',
      ...(vmCommand.importId && UUID.test(vmCommand.importId) ? { import: vmCommand.importId } : {}),
    };

  return null;
}

/** The command outcome an agent event reports; null for every other event. */
export function vmCommandOutcome(
  event: Pick<AgentEvent, 'labels' | 'message'> & Partial<Pick<AgentEvent, 'vmCommand'>>,
): VmCommandOutcome | null {
  const labels = event.labels ?? {};

  if (labels['kind'] !== 'virtual-machine') return null;

  const status = RESULTS[labels['result'] ?? ''];
  const replica = REPLICA.exec(labels['replica'] ?? '');

  if (!status || !replica) return null;

  const explicit = explicitCommand(event.vmCommand);

  if (explicit)
    return {
      ...explicit,
      project: replica[1],
      name: replica[2],
      status,
      error: status === 'failed' ? event.message.slice(0, 2000) : null,
    };

  // Older agents: failures name the message type ("vmPower failed: …"); successes carry `action` / `import`.
  const type: VmCommandType | null = labels['import']
    ? 'vmImageImport'
    : labels['action']
      ? 'vmPower'
      : event.message.startsWith('vmImageImport ')
        ? 'vmImageImport'
        : event.message.startsWith('vmPower ')
          ? 'vmPower'
          : null;

  if (!type) return null;

  return {
    type,
    project: replica[1],
    name: replica[2],
    ...(labels['action'] ? { action: labels['action'] } : {}),
    ...(labels['import'] ? { import: labels['import'] } : {}),
    status,
    error: status === 'failed' ? event.message.slice(0, 2000) : null,
  };
}

/**
 * Applies an outcome to the command it belongs to: a re-image by its import id, a power action to the oldest
 * still open (`sent` / `running`) command of that VM on the reporting node (with the same action when the event
 * names it). Returns the updated command id, or null when none matches (e.g. a command of an earlier CP version).
 */
export async function applyVmCommandOutcome(
  manager: Pick<EntityManager, 'getRepository'>,
  node: string,
  outcome: VmCommandOutcome,
): Promise<string | null> {
  const repo = manager.getRepository(VmCommandEntity);
  const open = await repo.find({
    where: {
      project: outcome.project,
      name: outcome.name,
      node,
      type: outcome.type,
      status: In(outcome.status === 'running' ? ['sent'] : ['sent', 'running']),
    },
    order: { createdAt: 'ASC' },
    take: 50,
  });
  const match = open.find((c) =>
    outcome.type === 'vmImageImport'
      ? !outcome.import || c.payload['import'] === outcome.import
      : !outcome.action || c.payload['action'] === outcome.action,
  );

  if (!match) return null;

  // Conditional on the status read, so a late `running` never reopens a finished command.
  const updated = await repo.update(
    { id: match.id, status: match.status },
    { status: outcome.status, error: outcome.error },
  );

  return updated.affected ? match.id : null;
}
