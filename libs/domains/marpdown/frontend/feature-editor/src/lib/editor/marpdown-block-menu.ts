import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx } from '@milkdown/kit/core';
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  htmlSchema,
  paragraphSchema,
} from '@milkdown/kit/preset/commonmark';

export const DEFAULT_MARP_DIRECTIVE = '<!-- _class: lead -->';

export const marpDirectiveIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M4 5C3.45 5 3 5.45 3 6V18C3 18.55 3.45 19 4 19H20C20.55 19 21 18.55 21 18V6C21 5.45 20.55 5 20 5H4ZM5 7H19V17H5V7ZM8.5 9.5L11 12.5L13.5 10L16.5 14H7.5L8.5 9.5Z"
    />
  </svg>
`;

export function insertMarpHtmlBlock(ctx: Ctx, value = DEFAULT_MARP_DIRECTIVE): void {
  const commands = ctx.get(commandsCtx);
  const paragraph = paragraphSchema.type(ctx);
  const html = htmlSchema.type(ctx);
  const block = paragraph.create(null, html.create({ value }));

  commands.call(clearTextInCurrentBlockCommand.key);
  commands.call(addBlockTypeCommand.key, { nodeType: block });
}

type BlockMenuBuilder = {
  addGroup: (
    key: string,
    label: string,
  ) => {
    addItem: (
      key: string,
      item: {
        label: string;
        icon: string;
        onRun?: (ctx: Ctx) => void;
      },
    ) => unknown;
  };
};

export function configureMarpBlockMenu(builder: BlockMenuBuilder): void {
  const marpGroup = builder.addGroup('marp', 'Marp');

  marpGroup.addItem('marp-directive', {
    label: 'Marp directive',
    icon: marpDirectiveIcon,
    onRun: (ctx) => {
      insertMarpHtmlBlock(ctx);
    },
  });
}
