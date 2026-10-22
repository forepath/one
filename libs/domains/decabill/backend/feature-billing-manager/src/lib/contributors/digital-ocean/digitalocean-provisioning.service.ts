import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { resolvePlainTextUserData } from '../../utils/cloud-init/user-data.utils';
import { ServerInfo } from '../../utils/provisioning.utils';
import { waitForTcpPort } from '../../utils/wait-for-tcp-port.util';
import { SshExecutorService } from '../../services/ssh-executor.service';

/** DigitalOcean caps user_data at 64KiB (plain text UTF-8). */
const MAX_USER_DATA_BYTES = 64 * 1024;
const DO_STATUS_POLL_INTERVAL_MS = 3000;
/** Soft ACPI shutdown may hang on cloud-init stop jobs; keep this short then hard-power. */
const DO_SHUTDOWN_ACTION_TIMEOUT_MS = 90 * 1000;
const DO_GUEST_HALT_WAIT_MS = 90 * 1000;
const DO_POWEROFF_TIMEOUT_MS = 5 * 60 * 1000;
const DO_RESIZE_TIMEOUT_MS = 10 * 60 * 1000;
const DO_ACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
/** Best-effort wait after resize; mid-life addons hard-wait again before SSH. */
const DO_SSH_READY_TIMEOUT_MS = 90 * 1000;
const DO_SSH_PORT = 22;
const DO_SSH_USER = 'root';
/** Immediate guest power-off; bypasses systemd stop jobs that stall DO ACPI power_off. */
const DO_GUEST_FORCE_POWEROFF_COMMAND =
  '/bin/sh -c "echo 1 > /proc/sys/kernel/sysrq 2>/dev/null; echo o > /proc/sysrq-trigger"';

@Injectable()
export class DigitaloceanProvisioningService {
  private readonly logger = new Logger(DigitaloceanProvisioningService.name);
  private readonly apiToken: string;
  private readonly sshExecutor: SshExecutorService;

  constructor(@Optional() sshExecutor?: SshExecutorService) {
    this.sshExecutor = sshExecutor ?? new SshExecutorService();
    this.apiToken = process.env.DIGITALOCEAN_API_TOKEN || '';

    if (!this.apiToken) {
      this.logger.warn(
        'DIGITALOCEAN_API_TOKEN environment variable is not set. DigitalOcean provisioning will not function.',
      );
    }
  }

  private resolveApiToken(apiToken?: string): string {
    return apiToken?.trim() || this.apiToken;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatDigitalOceanErrorMessage(axiosError: AxiosError, fallback: string): string {
    const data = axiosError.response?.data as DigitalOceanErrorResponse | undefined;
    const id = data?.id;
    const message = data?.message;

    if (id && message) {
      return `${id}: ${message}`;
    }

    if (message) {
      return message;
    }

    return axiosError.message || fallback;
  }

  private logDigitalOceanApiError(operation: string, serverId: string, error: unknown): void {
    const axiosError = error as AxiosError;
    const httpStatus = axiosError.response?.status;
    const detail = this.formatDigitalOceanErrorMessage(axiosError, axiosError.message);

    this.logger.error(
      `Failed to ${operation} DigitalOcean droplet ${serverId}${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${detail}`,
    );
  }

  private async fetchDroplet(serverId: string, token: string): Promise<{ status: string; locked: boolean }> {
    const response = await axios.get<{ droplet: DigitalOceanDroplet }>(
      `https://api.digitalocean.com/v2/droplets/${serverId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const droplet = response.data?.droplet;

    if (!droplet) {
      throw new BadRequestException('Invalid response from DigitalOcean API');
    }

    return { status: droplet.status, locked: droplet.locked === true };
  }

  private async waitForDropletStatus(
    serverId: string,
    token: string,
    targetStatus: string,
    options: { timeoutMs: number; operation: string },
  ): Promise<void> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const { status } = await this.fetchDroplet(serverId, token);

      if (status === targetStatus) {
        return;
      }

      await this.delay(DO_STATUS_POLL_INTERVAL_MS);
    }

    const { status: lastStatus } = await this.fetchDroplet(serverId, token);

    if (lastStatus === targetStatus) {
      return;
    }

    throw new BadRequestException(
      `Timed out waiting for DigitalOcean droplet ${serverId} to reach ${targetStatus} (last status: ${lastStatus})`,
    );
  }

  private async waitForAction(
    actionId: number,
    token: string,
    options: { timeoutMs: number; operation: string },
  ): Promise<void> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
      const response = await axios.get<{ action: DigitalOceanAction }>(
        `https://api.digitalocean.com/v2/actions/${actionId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const action = response.data?.action;

      if (!action) {
        throw new BadRequestException(`Invalid response while waiting for DigitalOcean action ${actionId}`);
      }

      if (action.status === 'completed') {
        return;
      }

      if (action.status === 'errored') {
        throw new BadRequestException(
          `DigitalOcean action ${actionId} failed during ${options.operation}` +
            (action.type ? ` (type: ${action.type})` : ''),
        );
      }

      await this.delay(DO_STATUS_POLL_INTERVAL_MS);
    }

    throw new BadRequestException(`Timed out waiting for DigitalOcean action ${actionId} during ${options.operation}`);
  }

  private async isDropletOff(serverId: string, token: string): Promise<boolean> {
    const { status } = await this.fetchDroplet(serverId, token);

    return status === 'off';
  }

  /**
   * DigitalOcean ACPI power_off can hang forever when guest systemd stop jobs never finish
   * (common while cloud-init is still running). Preferred sequence:
   * 1) Guest sysrq hard halt over SSH when a key is available
   * 2) API `shutdown` (issued, may not succeed) then hard `power_off`
   * Always wait for droplet status `off`, not only the action record (actions can stick in-progress).
   */
  private async ensureDropletPoweredOff(
    serverId: string,
    token: string,
    options?: { sshPrivateKey?: string },
  ): Promise<void> {
    if (await this.isDropletOff(serverId, token)) {
      return;
    }

    const sshPrivateKey = options?.sshPrivateKey?.trim();

    if (sshPrivateKey) {
      await this.tryGuestForcePowerOff(serverId, token, sshPrivateKey);

      if (await this.isDropletOff(serverId, token)) {
        return;
      }
    }

    this.logger.log(`Issuing DigitalOcean shutdown for droplet ${serverId} before size change`);
    await this.postDropletActionAndWait(serverId, token, 'shutdown', {
      timeoutMs: DO_SHUTDOWN_ACTION_TIMEOUT_MS,
      operation: 'shutdown droplet for size change',
      allowActionTimeout: true,
    });
    await this.waitForDropletStatusOptional(serverId, token, 'off', 30_000);

    if (await this.isDropletOff(serverId, token)) {
      return;
    }

    this.logger.log(`Issuing DigitalOcean power_off for droplet ${serverId} before size change`);
    await this.postDropletAction(serverId, token, 'power_off');
    await this.waitForDropletStatus(serverId, token, 'off', {
      timeoutMs: DO_POWEROFF_TIMEOUT_MS,
      operation: 'stop droplet for size change',
    });
  }

  private async tryGuestForcePowerOff(serverId: string, token: string, sshPrivateKey: string): Promise<void> {
    try {
      const serverInfo = await this.getServerInfo(serverId, token);
      const publicIp = serverInfo.publicIp?.trim();

      if (!publicIp) {
        this.logger.warn(`DigitalOcean droplet ${serverId} has no public IP for guest halt; skipping SSH poweroff`);

        return;
      }

      this.logger.log(`Attempting guest force poweroff over SSH on ${publicIp} (droplet ${serverId})`);
      await this.sshExecutor.waitUntilReachable(publicIp, DO_SSH_PORT, { timeoutMs: DO_SSH_READY_TIMEOUT_MS });

      try {
        await this.sshExecutor.exec(
          publicIp,
          DO_SSH_PORT,
          DO_SSH_USER,
          sshPrivateKey,
          DO_GUEST_FORCE_POWEROFF_COMMAND,
          {
            commandTimeoutMs: 15_000,
          },
        );
      } catch (error) {
        // Connection drop is expected once the guest begins powering off.
        this.logger.log(
          `Guest force poweroff SSH ended for droplet ${serverId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await this.waitForDropletStatusOptional(serverId, token, 'off', DO_GUEST_HALT_WAIT_MS);
    } catch (error) {
      this.logger.warn(
        `Guest force poweroff unavailable for droplet ${serverId}; falling back to API shutdown/power_off: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async waitForDropletStatusOptional(
    serverId: string,
    token: string,
    targetStatus: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if ((await this.fetchDroplet(serverId, token)).status === targetStatus) {
        return true;
      }

      await this.delay(DO_STATUS_POLL_INTERVAL_MS);
    }

    return (await this.fetchDroplet(serverId, token)).status === targetStatus;
  }

  private async postDropletAction(
    serverId: string,
    token: string,
    type: 'shutdown' | 'power_off' | 'power_on' | 'resize',
    body?: Record<string, unknown>,
  ): Promise<number | undefined> {
    const response = await axios.post<{ action: DigitalOceanAction }>(
      `https://api.digitalocean.com/v2/droplets/${serverId}/actions`,
      { type, ...(body ?? {}) },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return response.data?.action?.id;
  }

  private async postDropletActionAndWait(
    serverId: string,
    token: string,
    type: 'shutdown' | 'power_off' | 'power_on',
    options: { timeoutMs: number; operation: string; allowActionTimeout?: boolean },
  ): Promise<void> {
    const actionId = await this.postDropletAction(serverId, token, type);

    if (actionId == null) {
      return;
    }

    try {
      await this.waitForAction(actionId, token, {
        timeoutMs: options.timeoutMs,
        operation: options.operation,
      });
    } catch (error) {
      if (options.allowActionTimeout) {
        this.logger.warn(
          `DigitalOcean ${type} action ${actionId} did not finish cleanly during ${options.operation}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        return;
      }

      throw error;
    }
  }

  private async waitForDropletActiveAfterResize(serverId: string, token: string): Promise<void> {
    const { status: statusAfterResize } = await this.fetchDroplet(serverId, token);

    if (statusAfterResize === 'active') {
      this.logger.log(`DigitalOcean droplet ${serverId} is active after size change`);

      return;
    }

    this.logger.log(`DigitalOcean droplet ${serverId} still off after size change; powering on`);
    const powerOnActionId = await this.postDropletAction(serverId, token, 'power_on');

    if (powerOnActionId != null) {
      await this.waitForAction(powerOnActionId, token, {
        timeoutMs: DO_ACTIVE_TIMEOUT_MS,
        operation: 'start droplet after size change',
      });
    }

    await this.waitForDropletStatus(serverId, token, 'active', {
      timeoutMs: DO_ACTIVE_TIMEOUT_MS,
      operation: 'start droplet after size change',
    });
  }

  /**
   * Provisions a droplet. DigitalOcean's API expects plain-text cloud-init user_data; stack builders
   * base64-encode their scripts, so the user data is decoded first (see `resolvePlainTextUserData`).
   */
  async provisionServer(
    config: { name: string; serverType: string; location: string; userData: string },
    apiToken?: string,
  ) {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    const userDataPlain = resolvePlainTextUserData(config.userData);
    const userDataBytes = Buffer.byteLength(userDataPlain, 'utf8');

    if (userDataBytes > MAX_USER_DATA_BYTES) {
      throw new BadRequestException(
        `User data size (${userDataBytes} bytes) exceeds DigitalOcean limit of ${MAX_USER_DATA_BYTES} bytes`,
      );
    }

    try {
      const response = await axios.post<{ droplet: DigitalOceanDroplet }>(
        'https://api.digitalocean.com/v2/droplets',
        {
          name: config.name,
          region: config.location,
          size: config.serverType,
          image: 'ubuntu-22-04-x64',
          user_data: userDataPlain,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const serverId = response.data?.droplet?.id;

      if (!serverId) {
        throw new BadRequestException('Failed to provision server');
      }

      return { serverId: serverId.toString() };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to provision DigitalOcean droplet: ${axiosError.message}`);
      throw new BadRequestException(`Failed to provision server: ${axiosError.message}`);
    }
  }

  async deprovisionServer(serverId: string, apiToken?: string): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      this.logger.warn('DIGITALOCEAN_API_TOKEN not set, skipping deprovisioning');

      return;
    }

    try {
      await axios.delete(`https://api.digitalocean.com/v2/droplets/${serverId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      this.logger.log(`Successfully deprovisioned DigitalOcean droplet ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to deprovision DigitalOcean droplet ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to deprovision server: ${axiosError.message}`);
    }
  }

  async getServerInfo(serverId: string, apiToken?: string): Promise<ServerInfo> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      const response = await axios.get<{ droplet: DigitalOceanDroplet }>(
        `https://api.digitalocean.com/v2/droplets/${serverId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const droplet = response.data?.droplet;

      if (!droplet) {
        throw new BadRequestException('Invalid response from DigitalOcean API');
      }

      const publicIp = droplet.networks?.v4?.find((net) => net.type === 'public')?.ip_address ?? '';
      const privateIp = droplet.networks?.v4?.find((net) => net.type === 'private')?.ip_address;

      return {
        serverId: droplet.id.toString(),
        name: droplet.name,
        publicIp,
        privateIp,
        status: droplet.status,
        metadata: {
          region: droplet.region?.slug,
          regionName: droplet.region?.name,
        },
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to get DigitalOcean droplet info ${serverId}: ${axiosError.message}`);

      if (axiosError.response?.status === 404) {
        throw new BadRequestException(`Server ${serverId} not found`);
      }

      throw new BadRequestException(`Failed to get server info: ${axiosError.message}`);
    }
  }

  async startServer(serverId: string, apiToken?: string): Promise<void> {
    await this.executePowerAction(serverId, 'power_on', 'started', apiToken);
  }

  async stopServer(serverId: string, apiToken?: string): Promise<void> {
    await this.executePowerAction(serverId, 'power_off', 'stopped', apiToken);
  }

  async restartServer(serverId: string, apiToken?: string): Promise<void> {
    await this.executePowerAction(serverId, 'reboot', 'restarted', apiToken);
  }

  /**
   * In-place droplet resize via DigitalOcean API.
   * @param resizeDisk - Opt-in only. Mid-life changes keep the existing disk so downgrades
   *   remain possible later.
   */
  async changeServerType(
    serverId: string,
    serverType: string,
    options?: { resizeDisk?: boolean; apiToken?: string; sshPrivateKey?: string },
  ): Promise<void> {
    const token = this.resolveApiToken(options?.apiToken);

    if (!token) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      let { status: currentStatus } = await this.fetchDroplet(serverId, token);

      // Billing can enqueue a resize as soon as provider_reference exists while DO is still
      // status=new (no public IP yet). Wait for active so guest halt / ACPI can work.
      if (currentStatus !== 'off' && currentStatus !== 'active') {
        this.logger.log(
          `Waiting for DigitalOcean droplet ${serverId} to become active before size change (status: ${currentStatus})`,
        );
        await this.waitForDropletStatus(serverId, token, 'active', {
          timeoutMs: DO_ACTIVE_TIMEOUT_MS,
          operation: 'droplet ready for size change',
        });
        currentStatus = 'active';
      }

      if (currentStatus !== 'off') {
        this.logger.log(`Stopping DigitalOcean droplet ${serverId} before size change (status: ${currentStatus})`);
        await this.ensureDropletPoweredOff(serverId, token, { sshPrivateKey: options?.sshPrivateKey });
      }

      const resizeDisk = options?.resizeDisk === true;
      const resizeActionId = await this.postDropletAction(serverId, token, 'resize', {
        size: serverType,
        disk: resizeDisk,
      });

      if (resizeActionId == null) {
        throw new BadRequestException('DigitalOcean resize did not return an action id');
      }

      // Must wait for the resize *action* — droplet status stays "off" while resize runs, so
      // status-only polling returns too early and power_on races the unfinished resize.
      await this.waitForAction(resizeActionId, token, {
        timeoutMs: DO_RESIZE_TIMEOUT_MS,
        operation: 'resize droplet',
      });
      this.logger.log(`Changed DigitalOcean droplet ${serverId} size to ${serverType} (disk=${resizeDisk})`);

      await this.waitForDropletActiveAfterResize(serverId, token);
      await this.waitForSshAfterResize(serverId, token);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logDigitalOceanApiError('change size for', serverId, error);
      const axiosError = error as AxiosError;

      throw new BadRequestException(
        `Failed to change server type: ${this.formatDigitalOceanErrorMessage(axiosError, axiosError.message)}`,
      );
    }
  }

  private async waitForSshAfterResize(serverId: string, token: string): Promise<void> {
    const serverInfo = await this.getServerInfo(serverId, token);
    const publicIp = serverInfo.publicIp?.trim();

    if (!publicIp) {
      this.logger.warn(`DigitalOcean droplet ${serverId} has no public IP after size change; skipping SSH wait`);

      return;
    }

    try {
      await waitForTcpPort(publicIp, DO_SSH_PORT, { timeoutMs: DO_SSH_READY_TIMEOUT_MS });
      this.logger.log(`TCP ${publicIp}:${DO_SSH_PORT} is reachable (SSH after size change on ${serverId})`);
    } catch {
      // Resize-only changes must not fail when sshd/firewall is slow; mid-life addons wait again before SSH.
      this.logger.warn(
        `SSH on ${publicIp}:${DO_SSH_PORT} not reachable yet after size change on ${serverId}; continuing`,
      );
    }
  }

  private async executePowerAction(
    serverId: string,
    actionType: 'power_on' | 'power_off' | 'reboot',
    actionLabel: 'started' | 'stopped' | 'restarted',
    apiToken?: string,
  ): Promise<void> {
    const token = this.resolveApiToken(apiToken);

    if (!token) {
      throw new BadRequestException('DIGITALOCEAN_API_TOKEN environment variable is not set');
    }

    try {
      await axios.post(
        `https://api.digitalocean.com/v2/droplets/${serverId}/actions`,
        { type: actionType },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`${actionLabel} DigitalOcean droplet ${serverId}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to ${actionLabel} DigitalOcean droplet ${serverId}: ${axiosError.message}`);
      throw new BadRequestException(`Failed to ${actionLabel.replace('ed', '')} server: ${axiosError.message}`);
    }
  }
}

interface DigitalOceanErrorResponse {
  id?: string;
  message?: string;
}

interface DigitalOceanAction {
  id: number;
  status: string;
  type?: string;
}

interface DigitalOceanDroplet {
  id: number;
  name: string;
  status: string;
  locked?: boolean;
  region?: {
    name: string;
    slug: string;
  };
  networks?: {
    v4?: Array<{
      ip_address: string;
      type: 'public' | 'private';
    }>;
  };
}
