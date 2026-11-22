export interface BatchableUpsertItem<TEntry = unknown> {
  entry: TEntry;
  entityTable: string;
  payload: Record<string, unknown>;
  byteSize: number;
  keySignature: string;
}

export function buildPayloadKeySignature(payload: Record<string, unknown>): string {
  return Object.keys(payload).sort().join(',');
}

/**
 * Groups consecutive UPSERT items into homogeneous chunks sharing the same target table
 * and exact JSON key signature (preventing PostgREST PGRST102 key-mismatch errors while
 * respecting row count and payload byte limits).
 */
export function groupUpsertEntriesIntoBatches<TEntry>(
  items: BatchableUpsertItem<TEntry>[],
  options?: { maxBatchSize?: number; maxBatchBytes?: number }
): BatchableUpsertItem<TEntry>[][] {
  const maxBatchSize = options?.maxBatchSize ?? 75;
  const maxBatchBytes = options?.maxBatchBytes ?? 400_000;

  const batches: BatchableUpsertItem<TEntry>[][] = [];
  let currentBatch: BatchableUpsertItem<TEntry>[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const first = currentBatch[0];
    const fitsCurrent =
      first !== undefined &&
      first.entityTable === item.entityTable &&
      first.keySignature === item.keySignature &&
      currentBatch.length < maxBatchSize &&
      currentBytes + item.byteSize <= maxBatchBytes;

    if (!fitsCurrent) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [item];
      currentBytes = item.byteSize;
    } else {
      currentBatch.push(item);
      currentBytes += item.byteSize;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export interface RequiredParentRef {
  table: string;
  id: string;
}

const PARENT_FK_BY_TABLE: Record<string, { field: string; parentTable: string }[]> = {
  session_phases: [{ field: 'training_session_id', parentTable: 'training_sessions' }],
  session_blocks: [{ field: 'session_phase_id', parentTable: 'session_phases' }],
  session_notes: [{ field: 'training_session_id', parentTable: 'training_sessions' }],
  plan_weeks: [{ field: 'multi_week_plan_id', parentTable: 'multi_week_plans' }],
  multi_week_plans: [{ field: 'team_id', parentTable: 'teams' }],
  training_sessions: [{ field: 'team_id', parentTable: 'teams' }],
  team_members: [
    { field: 'team_id', parentTable: 'teams' },
    { field: 'club_member_id', parentTable: 'club_members' }
  ]
};

/**
 * Returns required parent references for a child entity payload so orphaned child UPSERTs
 * can be detected when their parent has already been deleted locally.
 */
export function getRequiredParentRefs(
  entityTable: string,
  payload: Record<string, unknown>
): RequiredParentRef[] {
  const defs = PARENT_FK_BY_TABLE[entityTable];
  if (!defs) return [];

  const refs: RequiredParentRef[] = [];
  for (const def of defs) {
    const val = payload[def.field];
    if (typeof val === 'string' && val.length > 0) {
      refs.push({ table: def.parentTable, id: val });
    }
  }
  return refs;
}
