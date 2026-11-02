import { TestBed } from '@angular/core/testing';
import {
  CloudInitConfigsFacade,
  CloudInitConfigsService,
  type CloudInitConfigResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { CloudInitConfigsPageComponent } from './cloud-init-configs-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

jest.mock('../monaco-editor-wrapper/monaco-editor-wrapper.component', () => {
  const { Component } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-monaco-editor-wrapper', standalone: true, template: '' })
  class MonacoEditorWrapperComponent {}

  return { MonacoEditorWrapperComponent };
});

const config = (id: string, isActive = true): CloudInitConfigResponse =>
  ({
    id,
    key: `cfg_${id}`,
    name: `Config ${id}`,
    provisioningMode: 'simple',
    dockerImage: 'nginx',
    isActive,
  }) as unknown as CloudInitConfigResponse;

describe('CloudInitConfigsPageComponent (data list)', () => {
  let service: { updateCloudInitConfig: jest.Mock; deleteCloudInitConfig: jest.Mock };
  let facade: Record<string, jest.Mock>;
  let component: CloudInitConfigsPageComponent;

  beforeEach(() => {
    service = { updateCloudInitConfig: jest.fn(), deleteCloudInitConfig: jest.fn() };
    facade = {
      getCloudInitConfigs$: jest.fn(() => of([config('c1'), config('c2'), config('c3', false)])),
      getCloudInitConfigsLoading$: jest.fn(() => of(false)),
      getCloudInitConfigsLoadingAny$: jest.fn(() => of(false)),
      getCloudInitConfigsCreating$: jest.fn(() => of(false)),
      getCloudInitConfigsUpdating$: jest.fn(() => of(false)),
      getCloudInitConfigsDeleting$: jest.fn(() => of(false)),
      getCloudInitConfigsError$: jest.fn(() => of(null)),
      loadCloudInitConfigs: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CloudInitConfigsFacade, useValue: facade },
        { provide: CloudInitConfigsService, useValue: service },
      ],
    });
    component = TestBed.runInInjectionContext(() => new CloudInitConfigsPageComponent());
  });

  it('shows State + name columns with a readable mode and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.provisioningModeLabel('compose-template')).toBe('Docker Compose template');
  });

  it('bulk Deactivate / Delete fan out per config with per-item results (incl. denied)', async () => {
    service.updateCloudInitConfig.mockReturnValue(of({}));
    component.selected.set(['c1', 'c3']);
    await component.setActiveSelected(false);
    expect(service.updateCloudInitConfig).toHaveBeenCalledTimes(1);
    expect(service.updateCloudInitConfig).toHaveBeenCalledWith('c1', { isActive: false });

    service.deleteCloudInitConfig.mockImplementation((id: string) =>
      id === 'c2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selected.set(['c1', 'c2']);
    await component.deleteSelected();
    expect(service.deleteCloudInitConfig).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(facade['loadCloudInitConfigs']).toHaveBeenCalled();
  });
});
