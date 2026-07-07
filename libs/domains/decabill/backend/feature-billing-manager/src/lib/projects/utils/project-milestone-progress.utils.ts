export function computeMilestoneProgressPercent(openTicketCount: number, doneTicketCount: number): number {
  const total = openTicketCount + doneTicketCount;

  return total === 0 ? 100 : Math.round((doneTicketCount / total) * 100);
}

export function isMilestoneComplete(progressPercent: number): boolean {
  return progressPercent >= 100;
}
