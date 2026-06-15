import type { TicketEntity } from '../entities/ticket.entity';

/** Counts markdown task checkboxes in ticket body: `[ ]` open, `[x]` / `[X]` done. */
export function countMarkdownCheckboxTasks(content: string | null | undefined): { open: number; done: number } {
  if (!content) {
    return { open: 0, done: 0 };
  }

  const done = content.match(/\[[xX]\]/g)?.length ?? 0;
  const open = content.match(/\[[ \t\u00A0]+\]/g)?.length ?? 0;

  return { open, done };
}

/**
 * For each ticket id, totals of checkbox counts on all **descendants** (not including the ticket itself).
 * `entities` must contain every ticket in the workspace tree being aggregated (typically all rows for a `clientId`).
 */
export function buildDescendantCheckboxTaskTotalsByTicketId(
  entities: TicketEntity[],
): Map<string, { open: number; done: number }> {
  const byParent = new Map<string | null, TicketEntity[]>();
  const own = new Map<string, { open: number; done: number }>();

  for (const t of entities) {
    own.set(t.id, countMarkdownCheckboxTasks(t.content));
    const p = t.parentId ?? null;

    if (!byParent.has(p)) {
      byParent.set(p, []);
    }

    byParent.get(p)!.push(t);
  }

  const memo = new Map<string, { open: number; done: number }>();

  function descendantsOnly(id: string): { open: number; done: number } {
    const hit = memo.get(id);

    if (hit) {
      return hit;
    }

    let o = 0;
    let d = 0;

    for (const k of byParent.get(id) ?? []) {
      const c = own.get(k.id)!;

      o += c.open;
      d += c.done;
      const sub = descendantsOnly(k.id);

      o += sub.open;
      d += sub.done;
    }

    const agg = { open: o, done: d };

    memo.set(id, agg);

    return agg;
  }

  const out = new Map<string, { open: number; done: number }>();

  for (const t of entities) {
    out.set(t.id, descendantsOnly(t.id));
  }

  return out;
}
