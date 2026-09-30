export class OpencodeMcpServerDto {
  name!: string;
  title!: string;
  description!: string;
  version!: string;
  status!: string;
  websiteUrl?: string;
  packages!: unknown[];
  remotes!: unknown[];
  repository?: Record<string, unknown>;
  publishedAt?: string;
  registryUpdatedAt?: string;
}

export class OpencodeMcpServersListDto {
  servers!: OpencodeMcpServerDto[];
  total!: number;
  limit!: number;
  offset!: number;
}
