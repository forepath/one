import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcVncChannelAdapter } from './vnc-channel';
import { FpcVncViewerComponent } from './vnc-viewer.component';

/**
 * Story-only wiring: a channel whose transport goes nowhere (no VNC server in Storybook), so the viewer stays in
 * `connecting` and shows its placeholder; "Disconnect" ends the session like a closed remote.
 */
@Component({
  selector: 'fpc-vnc-viewer-demo',
  standalone: true,
  imports: [FpcVncViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="height: 20rem">
      <fpc-vnc-viewer [channel]="channel()" placeholder="Connecting to the console…" ariaLabel="Demo console" />
    </div>
    <div class="mt-2 d-flex gap-2">
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="connect()">Connect</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="channel()?.closed(1000, 'demo')">
        Disconnect
      </button>
    </div>
  `,
})
class VncViewerDemoComponent {
  protected readonly channel = signal<FpcVncChannelAdapter | null>(null);

  constructor() {
    this.connect();
  }

  protected connect(): void {
    this.channel.set(new FpcVncChannelAdapter({ send: () => undefined, close: () => undefined }));
  }
}

const meta: Meta<FpcVncViewerComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Graphical remote consoles (virtual machine screens, remote desktops) over an authenticated transport.

**When not to:** Text consoles: use \`fpc-terminal\`. Screenshots or recordings: use an image / video.

Wraps noVNC. Instead of a WebSocket URL it takes a WebSocket-like \`[channel]\`: create an \`FpcVncChannelAdapter\` with your transport's \`send(ArrayBuffer)\` / \`close()\`, and call \`opened()\`, \`deliver(bytes)\`, \`closed(code, reason)\` or \`failed(message)\` as the transport reports. A new channel reconnects, \`null\` disconnects. The remote screen scales to the container (\`[scale]\`); \`[viewOnly]\` ignores input. Outputs: \`(connected)\`, \`(disconnected)\` (\`{ clean }\`), \`(credentialsRequired)\`, \`(desktopName)\`. Methods: \`sendCtrlAltDel()\`, \`sendCredentials(password)\`, \`focus()\`, \`disconnect()\`. The surface uses \`--bs-tertiary-bg\` and follows **Theme** / **Color set**.`,
      },
    },
  },
  title: 'Data Display/VNC Viewer',
  component: FpcVncViewerComponent,
  decorators: [moduleMetadata({ imports: [FpcVncViewerComponent, VncViewerDemoComponent] })],
  argTypes: {
    connected: { action: 'connected' },
    disconnected: { action: 'disconnected' },
  },
  args: { viewOnly: false, scale: true, placeholder: 'Not connected' },
  render: (args) => ({
    props: args,
    template: `<div style="height: 16rem">
        <fpc-vnc-viewer [viewOnly]="viewOnly" [scale]="scale" [placeholder]="placeholder" (connected)="connected($event)" (disconnected)="disconnected($event)" />
      </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcVncViewerComponent>;

export const Idle: Story = {};

export const Connecting: Story = {
  render: () => ({ template: `<fpc-vnc-viewer-demo />` }),
};
