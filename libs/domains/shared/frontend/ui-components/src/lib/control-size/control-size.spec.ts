import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, RouterOutlet } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { FpcButtonComponent } from '../button/button.component';
import { FpcFormControlComponent } from '../form-control/form-control.component';
import { provideFpcControlSize } from './control-size';

@Component({
  standalone: true,
  imports: [FpcFormControlComponent, FpcButtonComponent],
  template: `<fpc-form-control controlId="f" /><fpc-button>Go</fpc-button>`,
})
class PageComponent {}

@Component({ standalone: true, imports: [RouterOutlet], template: `<router-outlet />` })
class ShellComponent {}

describe('FPC_CONTROL_SIZE across routes', () => {
  async function render(url: string): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        // A console: dense by default ...
        provideFpcControlSize('sm'),
        provideRouter([
          {
            path: '',
            component: ShellComponent,
            children: [
              { path: 'guarded', component: PageComponent },
              // ... public pages inside it opt back into md.
              { path: 'login', component: PageComponent, providers: [provideFpcControlSize('md')] },
            ],
          },
        ]),
      ],
    });

    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl(url);

    return harness.routeNativeElement as HTMLElement;
  }

  it('renders guarded pages at the console tier', async () => {
    const root = await render('/guarded');

    expect(root.querySelector('input')?.className).toContain('form-control-sm');
    expect(root.querySelector('.btn')?.className).toContain('btn-sm');
  });

  it('renders public routes at md', async () => {
    const root = await render('/login');

    expect(root.querySelector('input')?.className).not.toContain('form-control-sm');
    expect(root.querySelector('.btn')?.className).not.toContain('btn-sm');
  });
});
