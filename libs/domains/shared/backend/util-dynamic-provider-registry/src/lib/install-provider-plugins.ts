import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertPathUnderPluginRoot } from './assert-plugin-path';
import { parseProviderPluginInstallSpec } from './parse-provider-package-spec';
import { DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV, DYNAMIC_PROVIDER_PLUGIN_PATH_ENV } from './types';

const PLUGIN_MANIFEST_NAME = 'forepath-dynamic-provider-plugins';

export class ProviderPluginInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderPluginInstallError';
  }
}

export async function installProviderPluginsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pluginPath = env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV]?.trim();

  if (!pluginPath) {
    return;
  }

  const installSpec = env[DYNAMIC_PROVIDER_PLUGIN_INSTALL_ENV];

  if (!installSpec?.trim()) {
    mkdirSync(pluginPath, { recursive: true });

    return;
  }

  mkdirSync(pluginPath, { recursive: true });
  ensurePluginManifest(pluginPath);

  const installTargets = parseProviderPluginInstallSpec(installSpec);

  for (const target of installTargets) {
    await installSingleTarget(target, pluginPath);
  }
}

function ensurePluginManifest(pluginPath: string): void {
  const manifestPath = join(pluginPath, 'package.json');

  if (existsSync(manifestPath)) {
    return;
  }

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        name: PLUGIN_MANIFEST_NAME,
        private: true,
        version: '0.0.0',
      },
      null,
      2,
    )}\n`,
  );
}

async function installSingleTarget(target: string, pluginPath: string): Promise<void> {
  const npmArg = resolveInstallTarget(target, pluginPath);

  await runNpmInstall(pluginPath, npmArg);
}

function resolveInstallTarget(target: string, pluginPath: string): string {
  if (target.startsWith('file:')) {
    const rawPath = target.slice('file:'.length).trim();

    if (!rawPath) {
      throw new ProviderPluginInstallError(`Invalid install target '${target}': missing path after 'file:'`);
    }

    const absolutePath = assertPathUnderPluginRoot(rawPath, pluginPath);

    return `file:${absolutePath}`;
  }

  return target;
}

function runNpmInstall(pluginPath: string, packageSpec: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', ['install', packageSpec, '--prefix', pluginPath, '--no-save', '--omit=dev'], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', (error) => {
      reject(new ProviderPluginInstallError(`Failed to spawn npm install: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();

        return;
      }

      reject(
        new ProviderPluginInstallError(
          `npm install ${packageSpec} --prefix ${pluginPath} failed with exit code ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

export function readPluginPathFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pluginPath = env[DYNAMIC_PROVIDER_PLUGIN_PATH_ENV]?.trim();

  return pluginPath ? resolve(pluginPath) : undefined;
}

export function readPluginManifest(pluginPath: string): { name: string } | undefined {
  const manifestPath = join(pluginPath, 'package.json');

  if (!existsSync(manifestPath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string };
}
