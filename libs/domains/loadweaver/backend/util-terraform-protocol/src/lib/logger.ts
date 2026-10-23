/**
 * Logs in hclog's JSON line format on stderr: Terraform parses these lines from plugin output and shows them with
 * `TF_LOG` / `TF_LOG_PROVIDER` (stdout is reserved for the handshake line).
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface PluginLogger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export function createPluginLogger(
  module: string,
  write: (line: string) => void = (line) => process.stderr.write(line),
): PluginLogger {
  return {
    log(level, message, fields = {}) {
      write(
        `${JSON.stringify({ '@level': level, '@message': message, '@module': module, '@timestamp': new Date().toISOString(), ...fields })}\n`,
      );
    },
  };
}
