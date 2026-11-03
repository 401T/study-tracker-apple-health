/**
 * Merge two canonical datasets without losing anything.
 * - Entities are matched by id; the one with the newer `updatedAt` wins.
 * - Entities present on only one side are kept.
 * - Nothing is ever removed (deletions are soft: `deletedAt` travels as an update).
 * Used by file import and by multi-device sync.
 */

import type { StudyDataset } from "./schema";

export interface MergeCounts {
  added: number;
  updated: number;
  skipped: number;
}

function mergeList<T extends { id: string; updatedAt: string }>(cur: T[], incoming: T[], counts?: MergeCounts): T[] {
  const out = [...cur];
  const byId = new Map(out.map((x, i) => [x.id, i]));
  for (const x of incoming) {
    const i = byId.get(x.id);
    if (i === undefined) {
      byId.set(x.id, out.length);
      out.push(x);
      if (counts) counts.added++;
    } else if (Date.parse(x.updatedAt) > Date.parse(out[i].updatedAt)) {
      out[i] = x;
      if (counts) counts.updated++;
    } else if (counts) counts.skipped++;
  }
  return out;
}

/** Returns a new dataset; `base` keeps its settings/meta unless `incoming` is newer overall. */
export function mergeDatasets(base: StudyDataset, incoming: StudyDataset): { dataset: StudyDataset; counts: MergeCounts } {
  const counts: MergeCounts = { added: 0, updated: 0, skipped: 0 };
  const incomingNewer = Date.parse(incoming.meta.updatedAt) > Date.parse(base.meta.updatedAt);
  const dataset: StudyDataset = {
    ...base,
    subjects: mergeList(base.subjects, incoming.subjects),
    tasks: mergeList(base.tasks, incoming.tasks),
    plans: mergeList(base.plans, incoming.plans),
    records: mergeList(base.records, incoming.records, counts),
    settings: incomingNewer ? incoming.settings : base.settings,
    activeSession: incomingNewer ? incoming.activeSession : base.activeSession,
  };
  if (incoming.extensions || base.extensions) dataset.extensions = { ...incoming.extensions, ...base.extensions };
  return { dataset, counts };
}
