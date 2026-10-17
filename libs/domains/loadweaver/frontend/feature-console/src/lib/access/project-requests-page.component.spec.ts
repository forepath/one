import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type CrossProjectRequest,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverProjectRequestsPageComponent } from './project-requests-page.component';

const request: CrossProjectRequest = {
  project: 'web',
  policy: 'allow-shop',
  peer: 'shop',
  specHash: 'b'.repeat(64),
  planId: null,
  accepted: false,
};

describe('LoadweaverProjectRequestsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverProjectRequestsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe) {
    facade = facadeStub(
      {
        requests$: [request],
        projectAccess$: { project: 'shop', members: [], settings: null, requests: [request] },
        projectLoading$: false,
        projectError$: null,
        changing$: false,
        changeError$: null,
      },
      ['openProject', 'accept'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverProjectRequestsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ project: 'shop' })) } },
        { provide: ConsoleAccessManagementFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverProjectRequestsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists the project’s requests and accepts after confirmation', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    const component = fixture.componentInstance;

    expect(facade['openProject']).toHaveBeenCalledWith('shop');
    expect(el().querySelector('[data-testid="access-requests"]')?.textContent).toContain('web');
    expect(el().querySelector('[data-testid="access-accept-web-allow-shop"]')).not.toBeNull();

    component.acceptFor.set(request);
    expect(component.acceptMessage()).toContain('allow-shop');
    component.confirmAccept();
    expect(facade['accept']).toHaveBeenCalledWith('shop', request);
    expect(component.acceptFor()).toBeNull();
  });

  it('hides accepting from developers', async () => {
    await setup({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } });

    expect(fixture.componentInstance.mayAccept()).toBe(false);
    expect(el().querySelector('[data-testid="access-accept-web-allow-shop"]')).toBeNull();
  });
});
