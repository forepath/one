export const PROJECT_DETAIL_TABS = ['board', 'milestones', 'time'] as const;

export type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number];

export function isProjectDetailTab(value: string | null | undefined): value is ProjectDetailTab {
  return PROJECT_DETAIL_TABS.includes(value as ProjectDetailTab);
}

export function parseProjectDetailTab(value: string | null | undefined): ProjectDetailTab {
  return isProjectDetailTab(value) ? value : 'board';
}
