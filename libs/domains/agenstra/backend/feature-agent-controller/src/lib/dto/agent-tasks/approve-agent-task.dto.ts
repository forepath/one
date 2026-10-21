import { IsISO8601 } from 'class-validator';

/** Body of `POST .../tasks/:taskId/approval`: the version (`updatedAt`) the user reviewed. */
export class ApproveAgentTaskDto {
  @IsISO8601({}, { message: 'updatedAt must be the ISO timestamp of the reviewed task' })
  updatedAt!: string;
}
