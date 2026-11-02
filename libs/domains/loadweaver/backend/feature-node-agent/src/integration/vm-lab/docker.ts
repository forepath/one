/**
 * Process helpers of the VM lab: the shared VM-lab harness (`@forepath/shared/backend/util-vm-lab`, M7.6) provides
 * them for Loadweaver's vm-lab and Agenstra's isolation-lab alike; this file keeps the lab's labels and import path.
 */
export { docker, dockerOk, run, type RunOptions, type RunResult, tarFiles } from '@forepath/shared/backend/util-vm-lab';

/** Label on every VM lab container / volume (value `run` or `golden`); the cleanup helper removes by label. */
export const LAB_LABEL = 'org.forepath.loadweaver.vm-lab';
export const RUN_LABEL = `${LAB_LABEL}.run`;
