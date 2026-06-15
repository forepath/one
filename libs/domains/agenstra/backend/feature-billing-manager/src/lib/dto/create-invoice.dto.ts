import { IsOptional, IsString } from 'class-validator';

export class CreateInvoiceDto {
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;
}
