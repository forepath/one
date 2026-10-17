import { Public } from '@forepath/identity/backend';
import {
  joinRequestSchema,
  type JoinRequest,
  type JoinResponse,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { NodesService } from '../services/nodes.service';
import { ZodValidationPipe } from '../utils/zod-validation.pipe';

const JOIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Node join (3.21). Authenticated by the single-use join token in the body instead of a user session:
 * the joining host has no identity yet. Strictly rate limited.
 */
@Controller('nodes')
export class NodeJoinController {
  constructor(private readonly nodes: NodesService) {}

  @Post('join')
  @Public()
  @Throttle(JOIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async join(@Body(new ZodValidationPipe(joinRequestSchema)) body: JoinRequest): Promise<JoinResponse> {
    return await this.nodes.join(body);
  }
}
