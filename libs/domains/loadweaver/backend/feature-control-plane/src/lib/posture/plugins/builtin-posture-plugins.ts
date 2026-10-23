import type { PosturePluginFactory } from '../../remote-access/posture-plugin';
import { crowdstrikePluginFactory } from './crowdstrike.plugin';
import { defenderPluginFactory } from './defender.plugin';
import { intunePluginFactory } from './intune.plugin';
import { jamfPluginFactory } from './jamf.plugin';
import { kandjiPluginFactory } from './kandji.plugin';
import { sentinelOnePluginFactory } from './sentinelone.plugin';

/** Built-in posture plugins (3.31); others come through `DYNAMIC_POSTURE_PLUGINS`. */
export const BUILTIN_POSTURE_PLUGINS: readonly PosturePluginFactory[] = [
  intunePluginFactory,
  jamfPluginFactory,
  kandjiPluginFactory,
  defenderPluginFactory,
  crowdstrikePluginFactory,
  sentinelOnePluginFactory,
];
