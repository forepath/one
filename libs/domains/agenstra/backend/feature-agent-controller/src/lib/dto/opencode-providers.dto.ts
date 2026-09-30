export class OpencodeProviderModelDto {
  id!: string;
  name!: string;
}

export class OpencodeProviderDto {
  id!: string;
  name!: string;
  env!: string[];
  models!: OpencodeProviderModelDto[];
  npm?: string;
  api?: string;
}

export class OpencodeProvidersListDto {
  providers!: OpencodeProviderDto[];
}
