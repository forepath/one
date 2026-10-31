import { afterNextRender, ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { moduleMetadata } from '@storybook/angular';

import { FpcTerminalComponent, type FpcTerminalSize } from './terminal.component';

/** Story-only echo shell: demonstrates wiring `(data)` / `write()` / `(sizeChange)` without a backend. */
@Component({
  selector: 'fpc-terminal-echo-demo',
  standalone: true,
  imports: [FpcTerminalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="height: 20rem">
      <fpc-terminal [fontSize]="fontSize()" (data)="onData($event)" (sizeChange)="size.set($event)" />
    </div>
    <div class="mt-2 d-flex gap-2 align-items-center small">
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="terminal().clear()">Clear</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="fontSize.set(fontSize() + 1)">A+</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="fontSize.set(fontSize() - 1)">A-</button>
      <span class="text-body-secondary">{{ size().cols }} × {{ size().rows }}</span>
    </div>
  `,
})
class TerminalEchoDemoComponent {
  protected readonly terminal = viewChild.required(FpcTerminalComponent);
  protected readonly fontSize = signal(13);
  protected readonly size = signal<FpcTerminalSize>({ cols: 0, rows: 0 });
  private line = '';

  constructor() {
    afterNextRender(() => {
      this.terminal().write(
        '\x1b[1mloadweaver\x1b[0m remote shell (demo)\r\n' +
          '\x1b[32m● ok\x1b[0m  \x1b[33m● warn\x1b[0m  \x1b[31m● error\x1b[0m  \x1b[34m● primary\x1b[0m  \x1b[36m● info\x1b[0m\r\n' +
          'Type something and press Enter.\r\n$ ',
      );
      this.terminal().focus();
    });
  }

  protected onData(value: string): void {
    const terminal = this.terminal();

    if (value === '\r') {
      terminal.write(`\r\n${this.line ? `echo: ${this.line}\r\n` : ''}$ `);
      this.line = '';
    } else if (value === '\u007f') {
      if (this.line.length) {
        this.line = this.line.slice(0, -1);
        terminal.write('\b \b');
      }
    } else {
      this.line += value;
      terminal.write(value);
    }
  }
}

const meta: Meta<FpcTerminalComponent> = {
  parameters: {
    docs: {
      description: {
        component: `**When to use:** Interactive shells and live log streams (remote access, container exec).

**When not to:** Static or searchable logs: use a list / pre block. Editing files: use \`fpc-code-editor\`.

Presentational xterm.js panel: forward \`(data)\` to the remote process, call \`write(text)\` with its output, and send \`(sizeChange)\` (\`{ cols, rows }\`) to the PTY. The grid is fitted to the container via ResizeObserver from xterm's measured cell size. Colours come from the brand (\`--bs-tertiary-bg\`, \`--bs-body-color\`, \`--bs-primary\`, semantic ANSI colours) and follow **Theme** / **Color set**.

Methods: \`write(text)\`, \`clear()\`, \`focus()\`, \`fit()\`. Set \`[visible]="false"\` to keep the session alive in a hidden tab.`,
      },
    },
  },

  title: 'Data Display/Terminal',
  component: FpcTerminalComponent,
  decorators: [moduleMetadata({ imports: [FpcTerminalComponent, TerminalEchoDemoComponent] })],
  argTypes: {
    data: { action: 'data' },
    sizeChange: { action: 'sizeChange' },
  },
  args: {
    fontSize: 13,
    visible: true,
  },
  render: (args) => ({
    props: args,
    template: `<div style="height: 16rem">
        <fpc-terminal [fontSize]="fontSize" [visible]="visible" (data)="data($event)" (sizeChange)="sizeChange($event)" />
      </div>`,
  }),
};

export default meta;

type Story = StoryObj<FpcTerminalComponent>;

export const Default: Story = {};

export const EchoShell: Story = {
  render: () => ({ template: `<fpc-terminal-echo-demo />` }),
};
