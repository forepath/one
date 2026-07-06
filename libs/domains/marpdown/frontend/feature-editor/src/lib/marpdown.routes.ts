import { Route } from '@angular/router';
import {
  AssetsFacade,
  assetsReducer,
  createAsset$,
  createPresentation$,
  deleteAsset$,
  deletePresentation$,
  EditorFacade,
  editorReducer,
  importEditorMarkdown$,
  importPresentationMarkdown$,
  listAssetDirectory$,
  loadPresentation$,
  loadPresentations$,
  loadPresentationsBatch$,
  moveAsset$,
  openEditor$,
  openGuestEditor$,
  PresentationsFacade,
  presentationsReducer,
  readAsset$,
  saveEditor$,
  updatePresentation$,
  writeAsset$,
} from '@forepath/marpdown/frontend/data-access-editor';
import { authGuard, identityAuthProviders, identityAuthRoutes } from '@forepath/identity/frontend';
import { provideEffects } from '@ngrx/effects';
import { provideState } from '@ngrx/store';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';

import { MarpdownContainerComponent } from './container/container.component';
import { PresentationEditorPageComponent } from './editor/presentation-editor-page.component';
import { guestEditorGuard } from './guards/guest-editor.guard';
import { marpdownEntryRedirectGuard } from './guards/marpdown-entry.guard';
import { PresentationsListPageComponent } from './presentations/presentations-list-page.component';

export const marpdownRoutes: Route[] = [
  {
    path: '',
    component: MarpdownContainerComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [marpdownEntryRedirectGuard],
        component: PresentationEditorPageComponent,
      },
      ...identityAuthRoutes,
      {
        path: 'editor',
        canActivate: [guestEditorGuard],
        component: PresentationEditorPageComponent,
        data: { guestMode: true },
        title: 'Editor :: Marpdown',
      },
      {
        path: 'presentations',
        canActivate: [authGuard],
        children: [
          {
            path: '',
            component: PresentationsListPageComponent,
            title: 'Presentations :: Marpdown',
          },
          {
            path: ':id',
            component: PresentationEditorPageComponent,
            title: 'Editor :: Marpdown',
          },
        ],
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
    providers: [
      ...identityAuthProviders,
      PresentationsFacade,
      EditorFacade,
      AssetsFacade,
      provideState('presentations', presentationsReducer),
      provideState('editor', editorReducer),
      provideState('assets', assetsReducer),
      provideEffects({
        loadPresentations$,
        loadPresentationsBatch$,
        loadPresentation$,
        createPresentation$,
        updatePresentation$,
        importPresentationMarkdown$,
        deletePresentation$,
        openEditor$,
        openGuestEditor$,
        saveEditor$,
        importEditorMarkdown$,
        listAssetDirectory$,
        readAsset$,
        writeAsset$,
        createAsset$,
        deleteAsset$,
        moveAsset$,
      }),
      provideMonacoEditor(),
    ],
  },
];
