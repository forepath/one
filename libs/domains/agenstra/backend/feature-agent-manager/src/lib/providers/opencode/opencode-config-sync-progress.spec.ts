import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR } from '@forepath/agenstra/shared/util-opencode-config';

import type { EnvironmentProgressDto } from '../../dto/environment-progress.dto';
import type { AgentsRepository } from '../../repositories/agents.repository';
import type { DockerService } from '../../services/docker.service';
import { EnvironmentProgressService } from '../../services/environment-progress.service';

import type { OpenCodeClientFactory } from './opencode-client.factory';
import { OpenCodeConfigSyncService } from './opencode-config-sync.service';

describe('OpenCodeConfigSyncService environment progress', () => {
  const workerImage = process.env.AGENSTRA_WORKER_SECURITY_TEST_IMAGE;
  const workerTest = workerImage ? it : it.skip;
  const agent = { id: 'agent-1', name: 'Agent One', containerId: 'container-1', opencodeUserSecrets: null };
  let agentsRepository: { findById: jest.Mock; update: jest.Mock };
  let dockerService: {
    getContainerEnvironmentMap: jest.Mock;
    updateContainer: jest.Mock;
    sendCommandToContainer: jest.Mock;
    getContainerHomeDirectory: jest.Mock;
  };
  let clientFactory: {
    invalidate: jest.Mock;
    waitForHealthy: jest.Mock;
    getClient: jest.Mock;
    resolveConnection: jest.Mock;
  };
  let progressService: EnvironmentProgressService;
  let emitted: EnvironmentProgressDto[];
  let service: OpenCodeConfigSyncService;
  let fetchSpy: jest.SpyInstance;
  let configSynced: jest.Mock;

  beforeEach(() => {
    agentsRepository = {
      findById: jest.fn().mockResolvedValue(agent),
      update: jest.fn().mockResolvedValue(agent),
    };
    dockerService = {
      getContainerEnvironmentMap: jest.fn().mockResolvedValue({}),
      updateContainer: jest.fn().mockResolvedValue('container-2'),
      sendCommandToContainer: jest.fn().mockResolvedValue(''),
      getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
    };
    clientFactory = {
      invalidate: jest.fn(),
      waitForHealthy: jest.fn().mockResolvedValue(undefined),
      getClient: jest.fn().mockResolvedValue({}),
      resolveConnection: jest.fn().mockResolvedValue({ baseUrl: 'http://opencode', authorization: 'Basic x' }),
    };
    progressService = new EnvironmentProgressService();
    emitted = [];
    progressService.registerBroadcaster((progress) => emitted.push(progress));
    service = new OpenCodeConfigSyncService(
      agentsRepository as unknown as AgentsRepository,
      clientFactory as unknown as OpenCodeClientFactory,
      dockerService as unknown as DockerService,
      progressService,
    );
    configSynced = jest.fn();
    service.registerConfigSyncedBroadcaster(configSynced);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
      json: async () => ({}),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function runWorkerInstallerTest(script: (installer: string) => string): Promise<void> {
    if (!workerImage) {
      throw new Error('AGENSTRA_WORKER_SECURITY_TEST_IMAGE is required');
    }

    expect((await service.syncEffective(agent.id, {}, {})).ok).toBe(true);
    const command: unknown = dockerService.sendCommandToContainer.mock.calls[0][1];

    if (!Array.isArray(command) || !command.every((argument): argument is string => typeof argument === 'string')) {
      throw new Error('Expected platform skill installation script');
    }

    const installer = command.map((argument) => `'${argument.replace(/'/g, "'\\''")}'`).join(' ');

    await promisify(execFile)(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '0',
        '--entrypoint',
        '/bin/sh',
        workerImage,
        '-c',
        script(installer),
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
  }

  workerTest.each(['symlink', 'hardlink'])(
    'safely replaces a worker-controlled %s and protects repeated syncs',
    async (linkType) => {
      await runWorkerInstallerTest(
        (installer) => `set -eu
dir=${JSON.stringify(AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR)}
install -d -m 755 -o agenstra -g agenstra "$dir"
fixture=$(mktemp)
printf 'protected fixture' > "$fixture"
chmod 600 "$fixture"
before=$(stat -c '%u:%g:%a' "$fixture")
ln ${linkType === 'symlink' ? '-s' : ''} "$fixture" "$dir/SKILL.md"
(${installer})
test "$(cat "$fixture")" = 'protected fixture'
test "$(stat -c '%u:%g:%a' "$fixture")" = "$before"
test ! -L "$dir/SKILL.md"
test "$(stat -c '%u:%g:%a' "$dir")" = '0:0:755'
test "$(stat -c '%u:%g:%a' "$dir/SKILL.md")" = '0:0:644'
runuser -u agenstra -- test -r "$dir/SKILL.md"
if runuser -u agenstra -- touch "$dir/worker-write"; then exit 1; fi
if runuser -u agenstra -- sh -c 'printf modified >> "$1"' sh "$dir/SKILL.md"; then exit 1; fi
(${installer})
test "$(cat "$fixture")" = 'protected fixture'
test "$(stat -c '%u:%g:%a' "$fixture")" = "$before"
test "$(stat -c '%u:%g:%a' "$dir/SKILL.md")" = '0:0:644'`,
      );
    },
    90_000,
  );

  workerTest.each(['directory-symlink', 'ancestor-symlink', 'writable-ancestor'])(
    'rejects an unsafe %s without modifying its target',
    async (attack) => {
      await runWorkerInstallerTest(
        (installer) => `set -eu
install -d -m 755 -o root -g root /opt/agenstra/skills
fixture=$(mktemp -d)
printf 'protected fixture' > "$fixture/SKILL.md"
chmod 600 "$fixture/SKILL.md"
before=$(stat -c '%u:%g:%a' "$fixture/SKILL.md")
${
  attack === 'directory-symlink'
    ? `ln -s "$fixture" ${JSON.stringify(AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR)}`
    : attack === 'ancestor-symlink'
      ? `rmdir /opt/agenstra/skills
ln -s "$fixture" /opt/agenstra/skills`
      : 'chmod 777 /opt/agenstra/skills'
}
if (${installer}); then exit 1; fi
test "$(cat "$fixture/SKILL.md")" = 'protected fixture'
test "$(stat -c '%u:%g:%a' "$fixture/SKILL.md")" = "$before"`,
      );
    },
    90_000,
  );

  workerTest(
    'ignores worker-controlled shell and utilities in the inherited PATH',
    async () => {
      await runWorkerInstallerTest(
        (installer) => `set -eu
runuser -u agenstra -- /bin/sh -c '
  mkdir -p /home/agenstra/.opencode/bin
  printf "%s\\n" "#!/bin/sh" "/usr/bin/id -u >> /tmp/platform-installer-hijacked" "exec /usr/bin/stat \\"\\$@\\"" > /home/agenstra/.opencode/bin/stat
  printf "%s\\n" "#!/bin/sh" "/usr/bin/id -u >> /tmp/platform-installer-hijacked" "exec /bin/sh \\"\\$@\\"" > /home/agenstra/.opencode/bin/sh
  chmod 755 /home/agenstra/.opencode/bin/stat /home/agenstra/.opencode/bin/sh
'
export PATH=/home/agenstra/.opencode/bin:$PATH
(${installer})
test ! -e /tmp/platform-installer-hijacked
test "$(/usr/bin/stat -c '%u:%g:%a' ${JSON.stringify(AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR)}/SKILL.md)" = '0:0:644'`,
      );
    },
    90_000,
  );

  it('does not report progress when the container env is unchanged', async () => {
    const result = await service.syncEffective(agent.id, {}, {});

    expect(result.ok).toBe(true);
    expect(dockerService.updateContainer).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(configSynced).toHaveBeenCalledWith(agent.id);
    expect(configSynced).toHaveBeenCalledTimes(1);
    expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
      agent.containerId,
      [
        '/usr/bin/env',
        '-i',
        'PATH=/usr/bin:/bin',
        '/bin/sh',
        '-c',
        expect.stringContaining('/opt/agenstra/skills/agenstra-ticket-automation/SKILL.md'),
      ],
      undefined,
      true,
      { user: '0' },
    );
    expect(
      dockerService.sendCommandToContainer.mock.calls.every(
        ([, command]) => !JSON.stringify(command).includes('/app/.opencode'),
      ),
    ).toBe(true);
    expect(dockerService.sendCommandToContainer.mock.invocationCallOrder.at(-1)).toBeLessThan(
      fetchSpy.mock.invocationCallOrder[0],
    );
  });

  it('reports update progress when secrets require container recreation', async () => {
    agentsRepository.findById
      .mockResolvedValueOnce(agent)
      .mockResolvedValueOnce({ ...agent, containerId: 'container-2' });
    const result = await service.syncEffective(agent.id, {}, { HTTP_PROXY: 'http://proxy:8080' });

    expect(result.ok).toBe(true);
    expect(dockerService.updateContainer).toHaveBeenCalled();
    expect([...new Set(emitted.map((e) => e.step))]).toEqual([
      'recreatingContainer',
      'waitingForHealthy',
      'finalizing',
    ]);
    expect(emitted.at(-1)).toEqual(
      expect.objectContaining({
        agentId: agent.id,
        agentName: agent.name,
        operation: 'update',
        status: 'completed',
        progress: 100,
      }),
    );
    expect(progressService.list()).toEqual([]);
    expect(configSynced).toHaveBeenCalledWith(agent.id);
    expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
      'container-2',
      [
        '/usr/bin/env',
        '-i',
        'PATH=/usr/bin:/bin',
        '/bin/sh',
        '-c',
        expect.stringContaining('install -d -m 755 -o root -g root'),
      ],
      undefined,
      true,
      { user: '0' },
    );
  });

  it('reports failure when container recreation fails', async () => {
    dockerService.updateContainer.mockRejectedValueOnce(new Error('docker down'));

    const result = await service.syncEffective(agent.id, {}, { HTTP_PROXY: 'http://proxy:8080' });

    expect(result.ok).toBe(false);
    expect(emitted.at(-1)).toEqual(
      expect.objectContaining({ status: 'failed', error: 'Failed to apply env secrets: docker down' }),
    );
    expect(progressService.list()).toEqual([]);
    expect(configSynced).not.toHaveBeenCalled();
  });

  it('reports failure when the worker never becomes healthy after recreation', async () => {
    clientFactory.waitForHealthy.mockRejectedValueOnce(new Error('timeout'));

    const result = await service.syncEffective(agent.id, {}, { HTTP_PROXY: 'http://proxy:8080' });

    expect(result.ok).toBe(false);
    expect(emitted.at(-1)).toEqual(expect.objectContaining({ status: 'failed', step: 'waitingForHealthy' }));
    expect(configSynced).not.toHaveBeenCalled();
  });

  it('does not signal sync when the worker rejects the config', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '{}',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid config',
      });

    expect(await service.syncEffective(agent.id, {}, {})).toEqual({ ok: false, error: 'invalid config' });
    expect(configSynced).not.toHaveBeenCalled();
  });

  it('does not signal deferred sync for a missing container', async () => {
    agentsRepository.findById.mockResolvedValue({ ...agent, containerId: null });

    expect(await service.syncEffective(agent.id, {}, {})).toEqual(expect.objectContaining({ ok: false, defer: true }));
    expect(configSynced).not.toHaveBeenCalled();
  });

  it('fails sync explicitly if platform installation fails', async () => {
    dockerService.sendCommandToContainer.mockRejectedValueOnce(new Error('permission denied'));

    expect(await service.syncEffective(agent.id, {}, {})).toEqual({ ok: false, error: 'permission denied' });
    expect(configSynced).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
