export const OPENCODE_SERVER_PORT = 4096;
export const OPENCODE_SERVER_USERNAME_DEFAULT = 'opencode';

/** Worker workspace mount; OpenCode PTY routes scope sessions by directory query. */
export const OPENCODE_PTY_DIRECTORY_DEFAULT = '/app';

/** Required on POST /pty/{id}/connect-token (browser CORS gate; server clients must send it too). */
export const OPENCODE_PTY_CONNECT_TOKEN_HEADER = 'x-opencode-ticket';
export const OPENCODE_PTY_CONNECT_TOKEN_HEADER_VALUE = '1';

/**
 * Baseline OpenCode config applied to every worker unless a higher layer overrides it.
 * Intentionally empty — OpenCode's own defaults (e.g. `ask` for `external_directory`) apply.
 */
export const OPENCODE_PLATFORM_DEFAULT_CONFIG: Record<string, unknown> = {};

/**
 * System instructions sent once when an OpenCode HTTP session is first established.
 */
export const OPENCODE_INITIALIZATION_INSTRUCTIONS = `COMMAND SYSTEM:
- You **HAVE** a command system that provides specialized agent configurations
- Executable commands **CAN** be found in the project folder at .opencode/commands
- Commands **ARE** markdown files that contain specific instructions and configurations
- You **CAN** execute these commands by using the /{filenamewithoutextension} format
- Example: A file named "ship.md" in .opencode/commands **IS** invoked as /ship

COMMAND EXECUTION:
- When you need to execute a command, you **MUST** look for it in .opencode/commands and invoke it using the /{filenamewithoutextension} format at the beginning of your message

CONTEXT:
- Project instructions **ARE** in AGENTS.md at the repository root (and nested AGENTS.md files)
- Additional OpenCode context **MAY** be found under .opencode/
- When processing a file, you **MUST** read and apply AGENTS.md and any relevant .opencode context
`;
