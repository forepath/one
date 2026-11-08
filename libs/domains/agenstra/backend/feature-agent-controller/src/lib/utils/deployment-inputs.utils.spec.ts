import { DEPLOYMENT_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException } from '@nestjs/common';

import { deploymentInputsError, mergeDeploymentInputs, normalizeDeploymentInputs } from './deployment-inputs.utils';

describe('deployment inputs', () => {
  it('accepts bounded string maps', () => {
    expect(deploymentInputsError({ env: 'prod', 'deploy.region-1': 'eu', _x: '' })).toBeNull();
    expect(normalizeDeploymentInputs(undefined)).toEqual({});
    expect(normalizeDeploymentInputs({ a: 'b' })).toEqual({ a: 'b' });
  });

  it('rejects non objects, invalid keys and non string / oversized values', () => {
    expect(deploymentInputsError([])).not.toBeNull();
    expect(deploymentInputsError('x')).not.toBeNull();
    expect(deploymentInputsError({ '1abc': 'x' })).not.toBeNull();
    expect(deploymentInputsError({ 'a b': 'x' })).not.toBeNull();
    expect(deploymentInputsError({ constructor: 'x' })).not.toBeNull();
    expect(deploymentInputsError({ ['k'.repeat(DEPLOYMENT_LIMITS.inputKeyMaxLength + 1)]: 'x' })).not.toBeNull();
    expect(deploymentInputsError({ a: 1 })).toBe('inputs.a must be a string');
    expect(deploymentInputsError({ a: 'x'.repeat(DEPLOYMENT_LIMITS.inputValueMaxLength + 1) })).not.toBeNull();
    expect(() => normalizeDeploymentInputs({ a: 1 }, 'defaultInputs')).toThrow(BadRequestException);
  });

  it('bounds the number of entries, also after merging', () => {
    const many = Object.fromEntries(
      Array.from({ length: DEPLOYMENT_LIMITS.inputsMax }, (_, index) => [`k${index}`, 'v']),
    );

    expect(deploymentInputsError(many)).toBeNull();
    expect(() => mergeDeploymentInputs(many, { extra: 'v' })).toThrow(BadRequestException);
    expect(mergeDeploymentInputs({ a: '1', b: '2' }, { b: '3' })).toEqual({ a: '1', b: '3' });
  });
});
