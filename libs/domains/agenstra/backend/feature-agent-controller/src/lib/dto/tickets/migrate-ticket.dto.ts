import { IsUUID } from 'class-validator';

/** Body for POST /tickets/:id/migrate — moves the ticket subtree to another workspace. */
export class MigrateTicketDto {
  @IsUUID('4')
  targetClientId!: string;
}
