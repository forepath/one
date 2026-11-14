import { IntegratedProvisioningService } from '../utils/cloud-init/integrated-provisioning-service';

export interface OrderProvisioningOptionDto {
  optionKey: string;
  type: 'integrated' | 'custom' | 'none';
  service?: IntegratedProvisioningService;
  cloudInitConfigId?: string;
  label: string;
  description?: string | null;
}
