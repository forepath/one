import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  VirtualMachineDetail,
  VirtualMachineSummary,
  VmAction,
  VmImageCatalog,
  VmImageImport,
  VmImageImportRequest,
  VmRegistryImage,
  VmImageUpstreamCatalog,
  VmSnapshot,
} from '../types/virtual-machines.types';
import { ConsoleApi } from './console-api';

const enc = encodeURIComponent;

/** Full virtual machines (3.35): status, power actions, snapshots and VM image imports. Specs change through plans. */
@Injectable({ providedIn: 'root' })
export class VirtualMachinesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(project?: string | null): Observable<VirtualMachineSummary[]> {
    return this.http.get<VirtualMachineSummary[]>(this.url('/virtual-machines'), {
      params: project ? { project } : {},
    });
  }

  get(project: string, name: string): Observable<VirtualMachineDetail> {
    return this.http.get<VirtualMachineDetail>(this.url(`/projects/${enc(project)}/virtual-machines/${enc(name)}`));
  }

  act(project: string, name: string, action: VmAction): Observable<VirtualMachineDetail> {
    return this.http.post<VirtualMachineDetail>(
      this.url(`/projects/${enc(project)}/virtual-machines/${enc(name)}/${enc(action)}`),
      {},
    );
  }

  snapshots(project: string, name: string): Observable<VmSnapshot[]> {
    return this.http.get<VmSnapshot[]>(this.url(`/projects/${enc(project)}/virtual-machines/${enc(name)}/snapshots`));
  }

  createSnapshot(project: string, name: string, description?: string): Observable<VmSnapshot> {
    return this.http.post<VmSnapshot>(
      this.url(`/projects/${enc(project)}/virtual-machines/${enc(name)}/snapshots`),
      description ? { description } : {},
    );
  }

  imageImports(project: string): Observable<VmImageImport[]> {
    return this.http.get<VmImageImport[]>(this.url(`/projects/${enc(project)}/vm-images/imports`));
  }

  /** VM image artifacts in the project's registry repositories (CLI pushes and imports). */
  registryImages(project: string): Observable<VmRegistryImage[]> {
    return this.http.get<VmRegistryImage[]>(this.url(`/projects/${enc(project)}/vm-images`));
  }

  importImage(project: string, request: VmImageImportRequest): Observable<VmImageImport> {
    return this.http.post<VmImageImport>(this.url(`/projects/${enc(project)}/vm-images/import`), request);
  }

  /** The VM image catalog (3.42): the release's recommended images and the cluster's own entries. */
  catalog(): Observable<VmImageCatalog> {
    return this.http.get<VmImageCatalog>(this.url('/vm-images/catalog'));
  }

  /** The distros' current builds (live checksum lookup; may be slow or empty): only on demand. */
  upstreamCatalog(): Observable<VmImageUpstreamCatalog> {
    return this.http.get<VmImageUpstreamCatalog>(this.url('/vm-images/catalog/upstream'));
  }
}
