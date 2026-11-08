import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator';

import { deploymentInputsError } from '../../utils/deployment-inputs.utils';

/**
 * String → string map of deployment inputs / variables / parameters, bounded by `DEPLOYMENT_LIMITS`
 * (`inputsMax`, `inputKeyMaxLength`, `inputValueMaxLength`). Combine with `@IsOptional()` for optional fields.
 */
export function IsDeploymentInputs(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isDeploymentInputs',
      target: target.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          return deploymentInputsError(value, args.property) === null;
        },
        defaultMessage(args: ValidationArguments): string {
          return deploymentInputsError(args.value, args.property) ?? `${args.property} is invalid`;
        },
      },
    });
  };
}
