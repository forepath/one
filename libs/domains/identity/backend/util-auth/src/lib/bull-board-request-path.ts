/**
 * Matches HTTP paths served by Bull Board (uses QUEUE_BULL_BOARD_PATH).
 * Used to bypass API guards that conflict with Bull Board's HTTP Basic auth.
 */
export function isBullBoardRequestPath(urlPath: string): boolean {
  const boardPath = (process.env.QUEUE_BULL_BOARD_PATH?.trim() || '/admin/queues').replace(/\/+$/, '');
  const base = boardPath.startsWith('/') ? boardPath : `/${boardPath}`;
  const path = urlPath.split('?')[0]?.replace(/\/+$/, '') ?? '';

  return path === base || path.startsWith(`${base}/`);
}
