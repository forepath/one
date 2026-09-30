import type { AcpLaunchSpec } from './acp-launch-spec.types';

export const ACP_INITIALIZATION_INSTRUCTIONS = `You are operating in a codebase with a structured command and rules system. Follow these guidelines:

COMMAND SYSTEM:
- Executable commands **CAN** be found in the project folder at .opencode/commands
- Each command **IS** a Markdown (.md) file
- The command invocation format **IS** /{filenamewithoutextension} (where filenamewithoutextension is the filename without the .md extension)
- Example: A file named "ship.md" in .opencode/commands **IS** invoked as /ship
- Commands **MUST** be at the start of a message to be recognized and executed
- When you need to execute a command, you **MUST** look for it in .opencode/commands and invoke it using the /{filenamewithoutextension} format at the beginning of your message

RULES SYSTEM:
- Project-specific instructions **CAN** be found in AGENTS.md at the project root
- Additional OpenCode context **MAY** be found under .opencode/
- When processing a file, you **MUST** read and apply AGENTS.md and any relevant .opencode context

MESSAGE HANDLING:
- This is a one-time initialization message to establish system context
- All subsequent messages you receive **WILL** be from users
- You **MUST** treat all messages after this initialization as user requests, tasks, or questions
- You **SHALL** respond to user messages as you would in a normal conversation, applying the command and rules system guidelines above`;

export const OPENCODE_ACP_LAUNCH_SPEC: AcpLaunchSpec = {
  executable: 'opencode',
  args: ['acp'],
  cwd: '/app',
  supportsLoadSession: true,
};

export function buildResumeSessionId(agentId: string, containerId: string, resumeSessionSuffix?: string): string {
  return `${agentId}-${containerId}${resumeSessionSuffix ?? ''}`;
}
