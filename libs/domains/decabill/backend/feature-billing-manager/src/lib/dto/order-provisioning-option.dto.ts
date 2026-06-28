export interface OrderProvisioningOptionDto {
  optionKey: string;
  type: 'integrated' | 'custom';
  service?: 'controller' | 'manager';
  cloudInitConfigId?: string;
  label: string;
  description?: string | null;
}
