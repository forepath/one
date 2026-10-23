// Shared VM-lab harness (M7.6): test-only consumers (Loadweaver's vm-lab, Agenstra's isolation-lab). Importing it has
// no side effects; everything that touches Docker runs only when called.
export * from './lib/exit';
export * from './lib/golden';
export * from './lib/images';
export * from './lib/lab-setup';
export * from './lib/locks';
export * from './lib/measure';
export * from './lib/memory';
export * from './lib/nested';
export * from './lib/process';
export * from './lib/qemu-args';
export * from './lib/spike';
export * from './lib/switch-lab';
export * from './lib/tunnel';
export * from './lib/user-net-vm';
