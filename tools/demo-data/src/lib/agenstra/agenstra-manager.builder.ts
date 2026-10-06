import { SOFTWARE_TOPICS } from '../core/fixtures';
import { RowCollector } from '../core/row-collector';

import { AgenstraSeedContext, DEMO_AGENT_SPECS, DemoAgent } from './agenstra-context';

const USER_PROMPTS = [
  'Can you summarize the open pull requests and what is blocking them?',
  'Please add unit tests for the price calculation module.',
  'Why does the build fail on the main branch since this morning?',
  'Refactor the session handling so tokens are refreshed in the background.',
  'Draft release notes for the changes merged this week.',
  'Find out which endpoints are missing rate limiting.',
] as const;
const AGENT_REPLIES = [
  'I went through the repository and found three places that need changes. I updated them and added tests.',
  'The failure comes from an outdated lockfile. I regenerated it and the build passes locally.',
  'Here is a summary:\n\n1. Two PRs wait for review\n2. One PR has merge conflicts\n3. One PR is blocked by CI',
  'Done. The new tests cover the edge cases for rounding and negative discounts.',
  'I could not reproduce the issue. Could you share the exact command you ran?',
] as const;

/** Builds agents (environments) with chat history, env vars, deployments and filter rules. */
export async function buildManagerData(context: AgenstraSeedContext, rows: RowCollector): Promise<DemoAgent[]> {
  const { random, hasher, managerEncryptor } = context;
  const agents: DemoAgent[] = [];

  for (const spec of DEMO_AGENT_SPECS) {
    const id = random.id();
    const password = random.alphanumeric(24);
    const createdAt = random.daysAgo(random.int(30, 200));
    const agent: DemoAgent = {
      id,
      name: spec.name,
      password,
      containerType: spec.containerType,
      homeWorkspaceKey: spec.workspace,
      chatSessionIds: [],
      createdAt,
    };

    rows.add('agents', {
      id,
      name: spec.name,
      description: `Coding agent for ${spec.repo}`,
      hashed_password: await hasher.hash(password, 10),
      // No container: the manager would try to restart it on boot. Chat history stays readable.
      container_id: null,
      volume_path: null,
      agent_type: 'opencode',
      container_type: spec.containerType,
      opencode_server_password: managerEncryptor.encrypt(random.alphanumeric(32)),
      opencode_user_config: null,
      opencode_user_overrides: null,
      opencode_user_secrets: null,
      git_repository_url: `https://git.example.com/${spec.repo}.git`,
      git_repository_setup_mode: random.chance(0.8) ? 'clone' : 'empty',
      created_at: createdAt,
      updated_at: random.daysAgo(random.int(0, 10)),
    });

    addChatSessions(context, rows, agent);
    addEnvironmentVariables(context, rows, agent);

    if (spec.containerType !== 'terraform') {
      addDeployments(context, rows, agent, spec.repo);
    }

    agents.push(agent);
  }

  return agents;
}

function serializeAgentReply(result: string): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result });
}

function addChatSessions(context: AgenstraSeedContext, rows: RowCollector, agent: DemoAgent): void {
  const { random } = context;
  const userSessionCount = random.int(1, 3);
  // User chats use their own id in the resume suffix, like agent-chat-sessions.service does.
  const sessions = [
    { id: random.id(), kind: 'primary', title: null as string | null, suffix: '' },
    ...Array.from({ length: userSessionCount }, () => {
      const chatId = random.id();
      const title = `About the ${random.pick(SOFTWARE_TOPICS)}`;

      return { id: chatId, kind: 'user', title, suffix: `-chat-${chatId}` };
    }),
  ];

  for (const session of sessions) {
    const sessionId = session.id;
    let messageAt = random.addDays(agent.createdAt, random.int(1, 20));
    const messageCount = random.int(2, 6) * 2;

    agent.chatSessionIds.push(sessionId);

    for (let i = 0; i < messageCount; i++) {
      const fromUser = i % 2 === 0;

      messageAt = random.addMinutes(messageAt, fromUser ? random.int(30, 600) : random.int(1, 6));
      rows.add('agent_messages', {
        id: random.id(),
        agent_id: agent.id,
        chat_session_id: sessionId,
        actor: fromUser ? 'user' : 'agent',
        // Agent messages store the serialized agent response, user messages the plain prompt.
        message: fromUser ? random.pick(USER_PROMPTS) : serializeAgentReply(random.pick(AGENT_REPLIES)),
        filtered: !fromUser && random.chance(0.05),
        created_at: messageAt,
        updated_at: messageAt,
      });
    }

    rows.add('agent_chat_sessions', {
      id: sessionId,
      agent_id: agent.id,
      title: session.title,
      kind: session.kind,
      resume_session_suffix: session.suffix,
      last_message_at: messageAt,
      created_at: agent.createdAt,
      updated_at: messageAt,
    });
  }
}

function addEnvironmentVariables(context: AgenstraSeedContext, rows: RowCollector, agent: DemoAgent): void {
  const { random, managerEncryptor } = context;
  const variables: [string, string][] = [
    ['NODE_ENV', 'development'],
    ['LOG_LEVEL', random.pick(['debug', 'info'])],
    ['DATABASE_URL', `postgres://app:${random.alphanumeric(12)}@db.internal:5432/app`],
    ['FEATURE_FLAGS', 'new-checkout,beta-search'],
  ];

  for (const [variable, content] of random.pickMany(variables, random.int(2, variables.length))) {
    rows.add('agent_environment_variables', {
      id: random.id(),
      agent_id: agent.id,
      variable,
      content: managerEncryptor.encrypt(content),
      created_at: agent.createdAt,
      updated_at: agent.createdAt,
    });
  }
}

function addDeployments(context: AgenstraSeedContext, rows: RowCollector, agent: DemoAgent, repo: string): void {
  const { random, managerEncryptor } = context;
  const configurationId = random.id();

  rows.add('deployment_configurations', {
    id: configurationId,
    agent_id: agent.id,
    provider_type: 'github',
    repository_id: repo,
    default_branch: 'main',
    workflow_id: 'deploy.yml',
    provider_token: managerEncryptor.encrypt(`ghp_demo${random.alphanumeric(30)}`),
    provider_base_url: null,
    created_at: agent.createdAt,
    updated_at: agent.createdAt,
  });

  const outcomes = [
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'in_progress', conclusion: null },
    { status: 'queued', conclusion: null },
  ];

  outcomes.forEach((outcome, index) => {
    const startedAt = random.daysAgo(outcomes.length - index, 12);
    const runNumber = random.int(100, 999);

    rows.add('deployment_runs', {
      id: random.id(),
      configuration_id: configurationId,
      provider_run_id: String(random.int(1000000000, 9999999999)),
      run_name: `Deploy #${runNumber}`,
      status: outcome.status,
      conclusion: outcome.conclusion,
      ref: 'main',
      sha: random.hex(40),
      workflow_id: 'deploy.yml',
      workflow_name: 'Deploy',
      started_at: outcome.status === 'queued' ? null : startedAt,
      completed_at: outcome.status === 'completed' ? random.addMinutes(startedAt, random.int(2, 15)) : null,
      html_url: `https://github.com/${repo}/actions/runs/${runNumber}`,
      created_at: startedAt,
      updated_at: startedAt,
    });
  });
}

export interface ManagerFilterRule {
  id: string;
  pattern: string;
  direction: string;
  filterType: string;
  replaceContent: string | null;
}

/** Filter rules as synced from the controller (`manager_rule_id` on the controller side). */
export function buildManagerFilterRules(context: AgenstraSeedContext, rows: RowCollector): ManagerFilterRule[] {
  const { random } = context;
  const rules: ManagerFilterRule[] = [
    {
      id: random.id(),
      pattern: 'sk-[A-Za-z0-9]{20,}',
      direction: 'outgoing',
      filterType: 'filter',
      replaceContent: '[redacted api key]',
    },
    {
      id: random.id(),
      pattern: '\\b\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}\\b',
      direction: 'bidirectional',
      filterType: 'drop',
      replaceContent: null,
    },
  ];

  rules.forEach((rule, index) => {
    const createdAt = random.daysAgo(random.int(20, 90));

    rows.add('regex_filter_rules', {
      id: rule.id,
      pattern: rule.pattern,
      regex_flags: 'g',
      direction: rule.direction,
      filter_type: rule.filterType,
      replace_content: rule.replaceContent,
      priority: index * 10,
      created_at: createdAt,
      updated_at: createdAt,
    });
  });

  return rules;
}
