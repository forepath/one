export class ServiceTypeResponseDto {
  id!: string;
  key!: string;
  name!: string;
  description?: string;
  provider!: string;
  configSchema!: Record<string, unknown>;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
