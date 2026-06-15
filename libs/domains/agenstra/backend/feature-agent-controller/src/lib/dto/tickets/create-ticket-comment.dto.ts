import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateTicketCommentDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(32000)
  body!: string;
}
