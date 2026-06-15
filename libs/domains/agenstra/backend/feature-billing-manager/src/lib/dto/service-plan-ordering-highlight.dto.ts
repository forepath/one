import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ServicePlanOrderingHighlightDto {
  @IsNotEmpty({ message: 'Icon is required for each ordering highlight' })
  @IsString({ message: 'Icon must be a string' })
  @MaxLength(128, { message: 'Icon must be at most 128 characters' })
  icon!: string;

  @IsNotEmpty({ message: 'Text is required for each ordering highlight' })
  @IsString({ message: 'Text must be a string' })
  @MaxLength(512, { message: 'Text must be at most 512 characters' })
  text!: string;
}
