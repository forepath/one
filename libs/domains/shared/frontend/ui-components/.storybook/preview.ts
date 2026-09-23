import type { Preview } from '@storybook/angular';

import { applyFpcDocumentGlobals } from './apply-document-globals';
import { FpcDocsContainer } from './docs-container';
import { installFpcGlobalsChannel } from './fpc-globals-channel';

// Bootstrap CSS and Bootstrap Icons are not imported here: the `@storybook/angular` builder
// compiles `preview.ts` without the Angular stylesheet pipeline, so global CSS is loaded through
// the `styles` option of the `storybook` / `build-storybook` targets in `project.json` instead.

installFpcGlobalsChannel();

const preview: Preview = {
  tags: ['autodocs'],
  initialGlobals: {
    theme: 'light',
    colorSet: 'bootstrap',
  },
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    options: {
      storySort: {
        order: ['Foundation', ['Theming', 'Fonts'], '*'],
      },
    },
    docs: {
      toc: true,
      container: FpcDocsContainer,
    },
  },
  globalTypes: {
    theme: {
      description: 'Bootstrap colour mode applied to the document element',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    colorSet: {
      description: 'Product brand palette overlay (Storybook mirror of app styles.scss)',
      toolbar: {
        title: 'Color set',
        icon: 'paintbrush',
        items: [
          { value: 'bootstrap', title: 'Bootstrap' },
          { value: 'decabill', title: 'Decabill' },
          { value: 'agenstra', title: 'Agenstra' },
          { value: 'forepath', title: 'ForePath' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (storyFn, context) => {
      // Canvas stories: context.globals is current; keeps attrs aligned if channel missed a beat.
      applyFpcDocumentGlobals(context.globals as Record<string, unknown>);
      return storyFn();
    },
  ],
};

export default preview;
