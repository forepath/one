import { AuthenticationType } from '@forepath/identity/backend';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ProvisionServerDto } from './provision-server.dto';

describe('ProvisionServerDto authenticationType', () => {
  const errorsFor = (authenticationType: string) =>
    validateSync(
      plainToInstance(ProvisionServerDto, {
        providerType: 'hetzner',
        serverType: 'cx22',
        name: 'server',
        authenticationType,
      }),
    ).filter((error) => error.property === 'authenticationType');

  it.each([AuthenticationType.API_KEY, AuthenticationType.OIDC])('accepts %s', (type) => {
    expect(errorsFor(type)).toHaveLength(0);
  });

  it.each([AuthenticationType.MTLS, 'other'])('rejects %s (provisioned managers have no operator CA)', (type) => {
    expect(errorsFor(type)).toHaveLength(1);
  });
});
