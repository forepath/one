export function formatProjectTimeReportDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatProjectTimeReportPeriod(startedAt: Date, endedAt: Date): string {
  const sameDay =
    startedAt.getFullYear() === endedAt.getFullYear() &&
    startedAt.getMonth() === endedAt.getMonth() &&
    startedAt.getDate() === endedAt.getDate();
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  if (sameDay) {
    const date = startedAt.toLocaleDateString('en-GB');
    const startTime = startedAt.toLocaleTimeString('en-GB', timeOptions);
    const endTime = endedAt.toLocaleTimeString('en-GB', timeOptions);

    return `${date} ${startTime} – ${endTime}`;
  }

  return `${startedAt.toLocaleString('en-GB')} – ${endedAt.toLocaleString('en-GB')}`;
}

export function formatProjectTimeReportRange(from: Date, to: Date): string {
  return `${from.toLocaleString('en-GB')} – ${to.toLocaleString('en-GB')}`;
}
