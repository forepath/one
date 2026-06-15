import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  RunVerifierCommandsDto,
  RunVerifierCommandsResponseDto,
  VerifierCommandResultDto,
} from '../dto/run-verifier-commands.dto';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

const MAX_CMD_LEN = 2048;
const MAX_OUTPUT = 256_000;

@Injectable()
export class AgentsVerificationService {
  private readonly logger = new Logger(AgentsVerificationService.name);

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentsRepository: AgentsRepository,
    private readonly dockerService: DockerService,
  ) {}

  private assertSafeCommand(cmd: string): void {
    if (cmd.includes('\n') || cmd.includes('\r')) {
      throw new BadRequestException('Verifier command must not contain newlines');
    }

    if (cmd.length > MAX_CMD_LEN) {
      throw new BadRequestException(`Verifier command exceeds maximum length (${MAX_CMD_LEN})`);
    }

    if (/[;&|`$<>]/.test(cmd)) {
      throw new BadRequestException('Verifier command contains disallowed shell metacharacters');
    }
  }

  private truncate(out: string): string {
    if (out.length <= MAX_OUTPUT) {
      return out;
    }

    return `${out.slice(0, MAX_OUTPUT)}\n...[truncated]`;
  }

  private parseExitMarker(output: string): { text: string; exitCode: number } {
    const trimmed = output.trimEnd();
    const match = trimmed.match(/__EXIT:(-?\d+)\s*$/);

    if (!match) {
      return { text: this.truncate(trimmed), exitCode: -1 };
    }

    const idx = trimmed.lastIndexOf(`__EXIT:${match[1]}`);
    const text = this.truncate(trimmed.slice(0, idx).trimEnd());

    return { text, exitCode: parseInt(match[1], 10) };
  }

  /**
   * Run bounded shell commands inside the agent container (sequential, fail-fast).
   */
  async runVerifierCommands(agentId: string, dto: RunVerifierCommandsDto): Promise<RunVerifierCommandsResponseDto> {
    await this.agentsService.findOne(agentId);
    const agentEntity = await this.agentsRepository.findByIdOrThrow(agentId);

    if (!agentEntity.containerId) {
      throw new NotFoundException(`Agent ${agentId} has no associated container`);
    }

    const containerId = agentEntity.containerId;
    const timeoutMs = dto.timeoutMs ?? 120_000;
    const results: VerifierCommandResultDto[] = [];

    for (const c of dto.commands) {
      this.assertSafeCommand(c.cmd);

      if (c.cwd) {
        this.assertSafeCommand(c.cwd);
      }

      const cwdPart = c.cwd ? `cd '${c.cwd.replace(/'/g, "'\\''")}' && ` : '';
      const inner = `( ${cwdPart}${c.cmd} ); echo __EXIT:$?\n`;
      const b64 = Buffer.from(inner, 'utf8').toString('base64');
      const wrapper = `echo ${b64}|base64 -d > /tmp/agenstra_verify.sh && sh /tmp/agenstra_verify.sh`;

      try {
        const raw = await Promise.race([
          this.dockerService.sendCommandToContainer(containerId, `sh -c "${wrapper}"`),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new BadRequestException('Verifier command timed out')), timeoutMs),
          ),
        ]);
        const { text, exitCode } = this.parseExitMarker(raw);

        results.push({ cmd: c.cmd, exitCode, output: text });

        if (exitCode !== 0) {
          break;
        }
      } catch (error: unknown) {
        const msg = (error as Error).message;

        this.logger.warn(`Verifier command failed for agent ${agentId}: ${msg}`);

        if (error instanceof BadRequestException) {
          throw error;
        }

        results.push({ cmd: c.cmd, exitCode: -1, output: msg });
        break;
      }
    }

    return { results };
  }
}
