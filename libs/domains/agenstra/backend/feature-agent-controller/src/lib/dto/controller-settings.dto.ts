import { IsString, MaxLength } from 'class-validator';

export class UpsertControllerSettingDto {
  @IsString({ message: 'value must be a string' })
  @MaxLength(16384, { message: 'value must be at most 16384 characters' })
  value!: string;
}
