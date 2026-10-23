import { vmLabGlobalTeardown } from '@forepath/shared/backend/util-vm-lab';

/** Releases the heavy / VM-lab locks the global setup took (the process exit would release them too). */
export default async function globalTeardown(): Promise<void> {
  await vmLabGlobalTeardown();
}
