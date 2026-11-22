const path = require('path');
const nxPreset = require('@nx/jest/preset').default;

const reporters = ['default'];
const isCi =
  process.env.CI === 'true' ||
  process.env.NX_TASK_TARGET_CONFIGURATION === 'ci';

// Emit compact per-project JSON under test-results/ for PR comments (CI only).
if (isCi) {
  reporters.push([
    path.join(__dirname, 'tools/ci/jest-pr-summary-reporter.cjs'),
    {},
  ]);
}

module.exports = {
  ...nxPreset,
  reporters,
  // CI runs several projects in parallel with coverage on 4-vCPU / 16 GB runners; recycle workers that grow past
  // 1 GB between test files so memory cannot pile up until the runner VM is shut down.
  ...(isCi ? { workerIdleMemoryLimit: '1GB' } : {}),
};
