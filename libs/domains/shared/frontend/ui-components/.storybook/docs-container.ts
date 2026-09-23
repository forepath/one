import React, { useEffect, useState, type PropsWithChildren, type ReactElement } from 'react';
import { DocsContainer, type DocsContainerProps } from '@storybook/addon-docs/blocks';

import { getPreviewGlobals, subscribePreviewGlobals } from './fpc-globals-channel';
import { createFpcStorybookTheme } from './fpc-storybook-theme';

/**
 * Storybook docs chrome (arg tables, preview toolbars, source panels, …) is emotion-themed
 * via DocsContainer's `theme` prop. Accent follows Color set primary; base follows Theme.
 */
export function FpcDocsContainer(props: PropsWithChildren<DocsContainerProps>): ReactElement {
  const [globals, setGlobals] = useState(getPreviewGlobals);

  useEffect(() => subscribePreviewGlobals(setGlobals), []);

  return React.createElement(
    DocsContainer,
    {
      ...props,
      theme: createFpcStorybookTheme(globals['theme'], globals['colorSet']),
    },
    props.children,
  );
}
