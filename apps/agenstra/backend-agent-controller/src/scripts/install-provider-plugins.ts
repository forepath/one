import { installProviderPluginsFromEnv } from '@forepath/shared/backend/util-dynamic-provider-registry';

async function main(): Promise<void> {
  await installProviderPluginsFromEnv();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
