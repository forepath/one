/**
 * Readable labels for enum-valued agent config options (AG-19, D7): the selects show words instead of the raw values
 * (`manual`, `true`, `subagent`), and the empty option says that the inherited default applies.
 */
export function agentConfigDefaultOptionLabel(): string {
  return $localize`:@@featureAgentConfig-optionDefault:Default (inherited)`;
}

export function agentConfigShareLabel(value: string): string {
  switch (value) {
    case 'manual':
      return $localize`:@@featureAgentConfig-shareManual:Manual`;
    case 'auto':
      return $localize`:@@featureAgentConfig-shareAuto:Automatic`;
    case 'disabled':
      return $localize`:@@featureAgentConfig-shareDisabled:Disabled`;
    default:
      return value;
  }
}

export function agentConfigUpdateLabel(value: string): string {
  switch (value) {
    case 'true':
      return $localize`:@@featureAgentConfig-updateAuto:Install automatically`;
    case 'false':
      return $localize`:@@featureAgentConfig-updateOff:Off`;
    case 'notify':
      return $localize`:@@featureAgentConfig-updateNotify:Notify only`;
    default:
      return value;
  }
}

export function agentConfigAgentModeLabel(value: string): string {
  switch (value) {
    case 'all':
      return $localize`:@@featureAgentConfig-agentModeAll:Primary and subagent`;
    case 'primary':
      return $localize`:@@featureAgentConfig-agentModePrimary:Primary only`;
    case 'subagent':
      return $localize`:@@featureAgentConfig-agentModeSubagent:Subagent only`;
    default:
      return value;
  }
}
