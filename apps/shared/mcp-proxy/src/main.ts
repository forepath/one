import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';

interface ProxyConfig {
  targetCommand: string;
  targetArgs: string[];
  restartDelay: number;
  maxRestartAttempts: number;
}

class McpProxy {
  private config: ProxyConfig;
  private childProcess: ChildProcess | null = null;
  private restartAttempts = 0;
  private isShuttingDown = false;
  private shouldRestart = true;

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.error('[MCP Proxy] Starting proxy server...');

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    await this.startTargetProcess();

    this.startFileWatcher();
  }

  private async startTargetProcess(): Promise<void> {
    if (this.isShuttingDown) return;

    try {
      console.error(
        `[MCP Proxy] Starting target process: ${this.config.targetCommand} ${this.config.targetArgs.join(' ')}`,
      );

      this.childProcess = spawn(this.config.targetCommand, this.config.targetArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });

      this.childProcess.stdout?.on('data', (data) => {
        process.stdout.write(data);
      });

      this.childProcess.stderr?.on('data', (data) => {
        process.stderr.write(data);
      });

      process.stdin.pipe(this.childProcess.stdin!);

      this.childProcess.on('exit', (code, signal) => {
        console.error(`[MCP Proxy] Target process exited with code ${code}, signal ${signal}`);
        this.childProcess = null;

        if (!this.isShuttingDown && this.shouldRestart) {
          this.scheduleRestart();
        }
      });

      this.childProcess.on('error', (error) => {
        console.error(`[MCP Proxy] Target process error:`, error);
        this.childProcess = null;

        if (!this.isShuttingDown && this.shouldRestart) {
          this.scheduleRestart();
        }
      });

      this.restartAttempts = 0;
      console.error('[MCP Proxy] Target process started successfully');
    } catch (error) {
      console.error(`[MCP Proxy] Failed to start target process:`, error);

      if (!this.isShuttingDown && this.shouldRestart) {
        this.scheduleRestart();
      }
    }
  }

  private scheduleRestart(): void {
    if (this.isShuttingDown) return;

    this.restartAttempts++;

    if (this.restartAttempts > this.config.maxRestartAttempts) {
      console.error(`[MCP Proxy] Max restart attempts (${this.config.maxRestartAttempts}) reached. Exiting.`);
      process.exit(1);
    }

    console.error(
      `[MCP Proxy] Scheduling restart in ${this.config.restartDelay}ms (attempt ${this.restartAttempts}/${this.config.maxRestartAttempts})`,
    );

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.startTargetProcess();
      }
    }, this.config.restartDelay);
  }

  private startFileWatcher(): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs');
    const targetPath = this.config.targetArgs[0];
    let watchPath: string;

    if (path.isAbsolute(targetPath)) {
      watchPath = path.dirname(targetPath);
    } else {
      const pathParts = targetPath.split(path.sep);

      if (pathParts.length >= 3) {
        watchPath = path.resolve(process.cwd(), pathParts.slice(0, -1).join(path.sep));
      } else {
        watchPath = path.resolve(process.cwd(), path.dirname(targetPath));
      }
    }

    try {
      if (fs.existsSync(watchPath)) {
        console.error(`[MCP Proxy] Watching for changes in: ${watchPath}`);

        fs.watch(watchPath, { recursive: true }, (eventType: string, filename: string) => {
          if (filename && (filename.endsWith('.js') || filename.endsWith('.json'))) {
            console.error(`[MCP Proxy] File change detected: ${filename}, restarting target process...`);
            this.restartTargetProcess();
          }
        });
      } else {
        console.error(`[MCP Proxy] Warning: watch directory not found at ${watchPath}, file watching disabled`);
      }
    } catch (error) {
      console.error(`[MCP Proxy] Error setting up file watcher:`, error);
    }
  }

  private restartTargetProcess(): void {
    if (this.childProcess && !this.childProcess.killed) {
      console.error('[MCP Proxy] Terminating target process for restart...');
      this.childProcess.kill('SIGTERM');

      setTimeout(() => {
        if (this.childProcess && !this.childProcess.killed) {
          console.error('[MCP Proxy] Force killing target process...');
          this.childProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  private async shutdown(): Promise<void> {
    console.error('[MCP Proxy] Shutting down proxy...');
    this.isShuttingDown = true;
    this.shouldRestart = false;

    if (this.childProcess && !this.childProcess.killed) {
      console.error('[MCP Proxy] Terminating target process...');
      this.childProcess.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        if (this.childProcess) {
          this.childProcess.on('exit', () => resolve());
          setTimeout(() => {
            if (this.childProcess && !this.childProcess.killed) {
              this.childProcess.kill('SIGKILL');
            }

            resolve();
          }, 5000);
        } else {
          resolve();
        }
      });
    }

    process.exit(0);
  }
}

const getTargetPath = (): string => {
  const envPath = process.env.MCP_DEVKIT_PATH;

  if (envPath) {
    console.error(`[MCP Proxy] Using MCP_DEVKIT_PATH from environment: ${envPath}`);

    return envPath;
  }

  const defaultPath = 'dist/apps/shared/mcp-devkit/main.js';

  console.error(`[MCP Proxy] Using default MCP_DEVKIT_PATH: ${defaultPath}`);

  return defaultPath;
};
const config: ProxyConfig = {
  targetCommand: 'node',
  targetArgs: [getTargetPath()],
  restartDelay: 1000,
  maxRestartAttempts: 10,
};
const proxy = new McpProxy(config);

proxy.start().catch((error) => {
  console.error('[MCP Proxy] Fatal error:', error);
  process.exit(1);
});
