import { BadRequestException } from '@nestjs/common';

import { ISOLATION_LEVELS, ISOLATION_RUNTIME_FAILURE_CODE } from '../../constants/container-isolation.constants';

import {
  isolationLevelOfContainerRuntime,
  LOADWEAVER_RUNTIMES,
  LoadweaverIsolationMappingError,
  loadweaverRuntimeForContainer,
  loadweaverRuntimeForUpdate,
  toIsolationLevel,
  toLoadweaverRuntime,
} from './isolation-mapping';

describe('Agenstra isolation level <-> Loadweaver runtime (M7.5)', () => {
  it('maps the four levels 1:1 in both directions', () => {
    expect(ISOLATION_LEVELS.map(toLoadweaverRuntime)).toEqual(['runc', 'sandboxed', 'sandboxed-kvm', 'microvm']);
    expect(LOADWEAVER_RUNTIMES.map(toIsolationLevel)).toEqual([...ISOLATION_LEVELS]);
  });

  it('throws E_ISOLATION_RUNTIME_FAILED for unknown values instead of falling back', () => {
    for (const fn of [() => toLoadweaverRuntime('kata'), () => toIsolationLevel('runsc'), () => toIsolationLevel('')]) {
      expect(fn).toThrow(LoadweaverIsolationMappingError);
      expect(fn).toThrow(BadRequestException);
    }

    try {
      toLoadweaverRuntime('gvisor');
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: ISOLATION_RUNTIME_FAILURE_CODE });
    }
  });

  it('derives the level from the container runtime names (configured names included)', () => {
    expect(isolationLevelOfContainerRuntime('runc')).toBe('standard');
    expect(isolationLevelOfContainerRuntime('runsc-systrap-hostnet')).toBe('sandboxed');
    expect(isolationLevelOfContainerRuntime('runsc-kvm')).toBe('sandboxed-kvm');
    expect(isolationLevelOfContainerRuntime('my-kvm', { AGENT_SANDBOX_KVM_RUNTIME: 'my-kvm' })).toBe('sandboxed-kvm');
    expect(isolationLevelOfContainerRuntime('runsc')).toBeNull();
  });

  it('maps create options: microVM launchers on runc, never a weaker or another level', () => {
    expect(loadweaverRuntimeForContainer('runc')).toBe('runc');
    expect(loadweaverRuntimeForContainer('runsc-kvm-hostnet')).toBe('sandboxed-kvm');
    expect(loadweaverRuntimeForContainer('runc', { microvm: true })).toBe('microvm');
    expect(() => loadweaverRuntimeForContainer('runsc-systrap', { microvm: true })).toThrow(
      LoadweaverIsolationMappingError,
    );
    expect(() => loadweaverRuntimeForContainer('kata')).toThrow(LoadweaverIsolationMappingError);
  });

  it('keeps microVMs microVMs on updates', () => {
    expect(loadweaverRuntimeForUpdate('microvm', 'runc')).toBe('microvm');
    expect(() => loadweaverRuntimeForUpdate('microvm', 'runsc-kvm')).toThrow(LoadweaverIsolationMappingError);
    expect(loadweaverRuntimeForUpdate('sandboxed', 'runsc-systrap')).toBe('sandboxed');
    expect(loadweaverRuntimeForUpdate('runc', 'runsc-kvm')).toBe('sandboxed-kvm');
  });
});
