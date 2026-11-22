import type { Table } from 'dexie';
import { db } from '../db/database';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import {
  buildPayloadKeySignature,
  getRequiredParentRefs,
  groupUpsertEntriesIntoBatches,
  type BatchableUpsertItem
} from '../utils/cloudSyncBatchUtils';
import type {
  Club,
  ClubMember,
  Exercise,
  MultiWeekPlan,
  PlanWeek,
  SessionBlock,
  SessionNote,
  SessionPhase,
  SessionTemplate,
  SyncOutboxItem,
  Team,
  TeamMember,
  TrainingSession
} from '../types/domain';

export { isSupabaseConfigured };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST_SYNCED_STORAGE_KEY = 'handball_last_synced_at';
const PULL_PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 200;
const UPSERT_BATCH_SIZE = 75;
const UPSERT_BATCH_BYTES = 400_000;

interface SupabaseQueryResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

async function fetchAllPaginated<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabaseQueryResult>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PULL_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) {
      return { data: allRows, error };
    }
    const page = (data ?? []) as T[];
    allRows.push(...page);
    if (page.length < PULL_PAGE_SIZE) {
      break;
    }
    from += PULL_PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

async function fetchAllByInFilter<T>(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  table: string,
  column: string,
  ids: string[]
): Promise<{ data: T[]; error: { message: string } | null }> {
  if (ids.length === 0) {
    return { data: [], error: null };
  }

  const allRows: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const idChunk = ids.slice(i, i + IN_CHUNK_SIZE);
    const res = await fetchAllPaginated<T>((from, to) =>
      supabase
        .from(table)
        .select('*')
        .in(column, idChunk)
        .order('id', { ascending: true })
        .range(from, to)
    );
    if (res.error) {
      return { data: allRows, error: res.error };
    }
    allRows.push(...res.data);
  }

  return { data: allRows, error: null };
}

export function isValidUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_REGEX.test(value));
}

export type CloudSyncMode = 'LOCAL_ONLY' | 'AUTH_REQUIRED' | 'NO_CLUB' | 'CLOUD';

export interface CloudSyncResult {
  mode: CloudSyncMode;
  pushedCount: number;
  pulledCount: number;
  errorMessage?: string;
}

export function getLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNCED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLastSyncedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNCED_STORAGE_KEY, iso);
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Clears all local Dexie tables (used when switching from demo data to a real cloud club, or on logout).
 */
export async function clearAllLocalDatabaseTables(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.clubs,
      db.clubMembers,
      db.teams,
      db.teamMembers,
      db.exercises,
      db.sessionTemplates,
      db.multiWeekPlans,
      db.planWeeks,
      db.trainingSessions,
      db.sessionPhases,
      db.sessionBlocks,
      db.sessionNotes,
      db.syncOutbox
    ],
    async () => {
      await Promise.all([
        db.clubs.clear(),
        db.clubMembers.clear(),
        db.teams.clear(),
        db.teamMembers.clear(),
        db.exercises.clear(),
        db.sessionTemplates.clear(),
        db.multiWeekPlans.clear(),
        db.planWeeks.clear(),
        db.trainingSessions.clear(),
        db.sessionPhases.clear(),
        db.sessionBlocks.clear(),
        db.sessionNotes.clear(),
        db.syncOutbox.clear()
      ]);
    }
  );
  try {
    localStorage.removeItem(LAST_SYNCED_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

const TABLE_SYNC_ORDER: Record<string, number> = {
  clubs: 1,
  club_members: 2,
  teams: 3,
  team_members: 4,
  exercises: 5,
  session_templates: 6,
  multi_week_plans: 7,
  plan_weeks: 8,
  training_sessions: 9,
  session_phases: 10,
  session_blocks: 11,
  session_notes: 12
};

const NULLABLE_UUID_FIELDS = [
  'user_id',
  'created_by_member_id',
  'parent_exercise_id',
  'owner_team_id',
  'plan_week_id',
  'exercise_id',
  'assigned_member_id',
  'session_block_id',
  'author_member_id'
];

const REQUIRED_UUID_FIELDS = [
  'club_id',
  'team_id',
  'club_member_id',
  'multi_week_plan_id',
  'training_session_id',
  'session_phase_id'
];

function sanitizeSyncPayload(raw: Record<string, unknown>): {
  payload: Record<string, unknown>;
  hasInvalidRequiredFk: boolean;
} {
  const payload: Record<string, unknown> = { ...raw };

  for (const field of REQUIRED_UUID_FIELDS) {
    if (field in payload && payload[field] !== undefined && payload[field] !== null) {
      if (typeof payload[field] !== 'string' || !isValidUuid(payload[field] as string)) {
        return { payload, hasInvalidRequiredFk: true };
      }
    }
  }

  for (const field of NULLABLE_UUID_FIELDS) {
    if (field in payload) {
      const val = payload[field];
      if (val === '' || val === undefined || (typeof val === 'string' && !isValidUuid(val))) {
        payload[field] = null;
      }
    }
  }

  return { payload, hasInvalidRequiredFk: false };
}

async function ensureParentChainPushed(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  table: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (table === 'session_phases' && typeof payload.training_session_id === 'string') {
    const parentSession = await db.trainingSessions.get(payload.training_session_id);
    if (parentSession && isValidUuid(parentSession.id)) {
      const { payload: sessionPayload, hasInvalidRequiredFk } = sanitizeSyncPayload(
        parentSession as unknown as Record<string, unknown>
      );
      if (!hasInvalidRequiredFk) {
        await supabase.from('training_sessions').upsert(sessionPayload, { onConflict: 'id' });
      }
    }
  } else if (table === 'session_blocks' && typeof payload.session_phase_id === 'string') {
    const parentPhase = await db.sessionPhases.get(payload.session_phase_id);
    if (parentPhase && isValidUuid(parentPhase.id)) {
      const phaseRaw = parentPhase as unknown as Record<string, unknown>;
      await ensureParentChainPushed(supabase, 'session_phases', phaseRaw);
      const { payload: phasePayload, hasInvalidRequiredFk } = sanitizeSyncPayload(phaseRaw);
      if (!hasInvalidRequiredFk) {
        await supabase.from('session_phases').upsert(phasePayload, { onConflict: 'id' });
      }
    }
  } else if (table === 'plan_weeks' && typeof payload.multi_week_plan_id === 'string') {
    const parentPlan = await db.multiWeekPlans.get(payload.multi_week_plan_id);
    if (parentPlan && isValidUuid(parentPlan.id)) {
      const { payload: planPayload, hasInvalidRequiredFk } = sanitizeSyncPayload(
        parentPlan as unknown as Record<string, unknown>
      );
      if (!hasInvalidRequiredFk) {
        await supabase.from('multi_week_plans').upsert(planPayload, { onConflict: 'id' });
      }
    }
  }
}

const LOCAL_TABLE_BY_NAME: Record<string, { get: (id: string) => Promise<unknown> }> = {
  teams: db.teams,
  club_members: db.clubMembers,
  team_members: db.teamMembers,
  multi_week_plans: db.multiWeekPlans,
  plan_weeks: db.planWeeks,
  training_sessions: db.trainingSessions,
  session_phases: db.sessionPhases,
  session_blocks: db.sessionBlocks,
  session_notes: db.sessionNotes
};

async function isOrphanedChildUpsert(
  entityTable: string,
  entityId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const parentRefs = getRequiredParentRefs(entityTable, payload);
  if (parentRefs.length === 0) return false;

  const selfTable = LOCAL_TABLE_BY_NAME[entityTable];
  if (selfTable) {
    const localSelf = await selfTable.get(entityId);
    if (!localSelf) return true;
  }

  for (const ref of parentRefs) {
    const parentTable = LOCAL_TABLE_BY_NAME[ref.table];
    if (parentTable) {
      const localParent = await parentTable.get(ref.id);
      if (!localParent) return true;
    }
  }

  return false;
}

interface OutboxGroupedEntry {
  latest: SyncOutboxItem;
  supersededIds: number[];
}

/**
 * Flushes all pending local Sync-Outbox operations to Supabase PostgreSQL
 * using the authenticated user's session JWT.
 */
export async function flushSyncOutboxToCloud(options?: {
  onProgress?: (processed: number, total: number) => void;
}): Promise<{
  flushedCount: number;
  failedCount: number;
  lastErrorMessage?: string;
  mode: CloudSyncMode;
}> {
  if (!isSupabaseConfigured()) {
    return { flushedCount: 0, failedCount: 0, mode: 'LOCAL_ONLY' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { flushedCount: 0, failedCount: 0, mode: 'LOCAL_ONLY' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { flushedCount: 0, failedCount: 0, mode: 'AUTH_REQUIRED' };
  }

  const pendingItems = await db.syncOutbox.where('synced').equals(0).sortBy('id');
  if (pendingItems.length === 0) {
    return { flushedCount: 0, failedCount: 0, mode: 'CLOUD' };
  }

  // Deduplicate multiple operations on the same entity: keep only the latest operation per (table, id)
  const grouped = new Map<string, OutboxGroupedEntry>();
  for (const item of pendingItems) {
    const key = `${item.entity_table}:${item.entity_id}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { latest: item, supersededIds: [] });
    } else {
      if (existing.latest.id !== undefined) {
        existing.supersededIds.push(existing.latest.id);
      }
      existing.latest = item;
    }
  }

  const entries = Array.from(grouped.values()).sort((a, b) => {
    const itemA = a.latest;
    const itemB = b.latest;
    // Run UPSERTs before DELETEs; UPSERTs in parent->child order, DELETEs in child->parent order
    if (itemA.operation !== itemB.operation) {
      return itemA.operation === 'UPSERT' ? -1 : 1;
    }
    const orderA = TABLE_SYNC_ORDER[itemA.entity_table] ?? 99;
    const orderB = TABLE_SYNC_ORDER[itemB.entity_table] ?? 99;
    if (orderA !== orderB) {
      return itemA.operation === 'UPSERT' ? orderA - orderB : orderB - orderA;
    }
    return (itemA.id ?? 0) - (itemB.id ?? 0);
  });

  let flushedCount = 0;
  let failedCount = 0;
  let lastErrorMessage: string | undefined;

  async function markSynced(ids: (number | undefined)[]) {
    const validIds = ids.filter((id): id is number => id !== undefined);
    if (validIds.length === 0) return;
    await db.syncOutbox.where('id').anyOf(validIds).modify({ synced: 1 });
  }

  const validUpsertItems: BatchableUpsertItem<OutboxGroupedEntry>[] = [];
  const deleteEntries: OutboxGroupedEntry[] = [];

  for (const entry of entries) {
    const { latest: item, supersededIds } = entry;
    // Skip legacy non-UUID demo records so they never block real cloud sync
    if (!isValidUuid(item.entity_id)) {
      await markSynced([item.id, ...supersededIds]);
      continue;
    }

    if (item.operation === 'DELETE') {
      deleteEntries.push(entry);
      continue;
    }

    try {
      const rawPayload = JSON.parse(item.payload_json) as Record<string, unknown>;
      const { payload, hasInvalidRequiredFk } = sanitizeSyncPayload(rawPayload);

      if (hasInvalidRequiredFk) {
        // Record references a local demo ID and cannot exist in Supabase
        await markSynced([item.id, ...supersededIds]);
        continue;
      }

      if (await isOrphanedChildUpsert(item.entity_table, item.entity_id, payload)) {
        // Child or its parent was already deleted locally; drop stale outbox UPSERT
        await markSynced([item.id, ...supersededIds]);
        continue;
      }

      validUpsertItems.push({
        entry,
        entityTable: item.entity_table,
        payload,
        byteSize: item.payload_json.length,
        keySignature: buildPayloadKeySignature(payload)
      });
    } catch (err) {
      failedCount++;
      lastErrorMessage = err instanceof Error ? err.message : 'Ungültige Sync-Nutzlast';
    }
  }

  const totalToSync = validUpsertItems.length + deleteEntries.length;
  let processedCount = 0;

  async function upsertSingleItem(bItem: BatchableUpsertItem<OutboxGroupedEntry>) {
    const { latest: item, supersededIds } = bItem.entry;
    try {
      let { error } = await supabase!
        .from(bItem.entityTable)
        .upsert(bItem.payload, { onConflict: 'id' });

      // Self-heal if a parent phase/session/plan was missing from Supabase
      if (error) {
        await ensureParentChainPushed(supabase!, bItem.entityTable, bItem.payload);
        const retryRes = await supabase!
          .from(bItem.entityTable)
          .upsert(bItem.payload, { onConflict: 'id' });
        error = retryRes.error;
      }

      if (!error) {
        await markSynced([item.id, ...supersededIds]);
        flushedCount++;
      } else {
        failedCount++;
        lastErrorMessage = error.message;
      }
    } catch (err) {
      failedCount++;
      lastErrorMessage = err instanceof Error ? err.message : 'Netzwerkfehler beim Sync';
    } finally {
      processedCount++;
      options?.onProgress?.(processedCount, totalToSync);
    }
  }

  const upsertBatches = groupUpsertEntriesIntoBatches(validUpsertItems, {
    maxBatchSize: UPSERT_BATCH_SIZE,
    maxBatchBytes: UPSERT_BATCH_BYTES
  });

  for (const batch of upsertBatches) {
    if (batch.length === 1) {
      await upsertSingleItem(batch[0]);
      continue;
    }

    try {
      const table = batch[0].entityTable;
      const batchPayloads = batch.map((b) => b.payload);
      const { error } = await supabase.from(table).upsert(batchPayloads, { onConflict: 'id' });

      if (!error) {
        const allOutboxIds = batch.flatMap((b) => [b.entry.latest.id, ...b.entry.supersededIds]);
        await markSynced(allOutboxIds);
        flushedCount += batch.length;
        processedCount += batch.length;
        options?.onProgress?.(processedCount, totalToSync);
      } else {
        // Fall back to single-row upsert so a missing parent or single bad row does not block the chunk
        for (const bItem of batch) {
          await upsertSingleItem(bItem);
        }
      }
    } catch {
      for (const bItem of batch) {
        await upsertSingleItem(bItem);
      }
    }
  }

  for (const { latest: item, supersededIds } of deleteEntries) {
    try {
      const { error } = await supabase
        .from(item.entity_table)
        .delete()
        .eq('id', item.entity_id);
      if (!error) {
        await markSynced([item.id, ...supersededIds]);
        flushedCount++;
      } else {
        failedCount++;
        lastErrorMessage = error.message;
      }
    } catch (err) {
      failedCount++;
      lastErrorMessage = err instanceof Error ? err.message : 'Netzwerkfehler beim Sync';
    } finally {
      processedCount++;
      options?.onProgress?.(processedCount, totalToSync);
    }
  }

  return { flushedCount, failedCount, lastErrorMessage, mode: 'CLOUD' };
}

function mergeByUpdatedAt<T extends { id: string; updated_at?: string }>(
  localRows: T[],
  remoteRows: T[],
  pendingIds: Set<string>
): T[] {
  const localMap = new Map(localRows.map((r) => [r.id, r]));
  const toPut: T[] = [];

  for (const remote of remoteRows) {
    if (pendingIds.has(remote.id)) {
      continue;
    }
    const local = localMap.get(remote.id);
    if (!local) {
      toPut.push(remote);
      continue;
    }
    const remoteTs = remote.updated_at ? Date.parse(remote.updated_at) : 0;
    const localTs = local.updated_at ? Date.parse(local.updated_at) : 0;
    if (remoteTs >= localTs) {
      toPut.push(remote);
    }
  }

  return toPut;
}

/**
 * Returns IDs of local rows that no longer exist remotely (deleted on the server,
 * e.g. by another coach or a Vereins-Reset) and have no pending local changes.
 */
export function findDeletedLocalIds<T extends { id: string }>(
  localRows: T[],
  remoteRows: T[],
  pendingIds: Set<string>
): string[] {
  const remoteIds = new Set(remoteRows.map((r) => r.id));
  return localRows
    .filter((local) => !remoteIds.has(local.id) && !pendingIds.has(local.id))
    .map((local) => local.id);
}

/**
 * Performs a full bidirectional sync:
 * 1. Pushes pending local outbox changes to Supabase.
 * 2. Pulls the user's club data from Supabase into local IndexedDB (Last-Write-Wins).
 */
export async function syncWithSupabaseCloud(): Promise<CloudSyncResult> {
  if (!isSupabaseConfigured()) {
    return { mode: 'LOCAL_ONLY', pushedCount: 0, pulledCount: 0 };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { mode: 'LOCAL_ONLY', pushedCount: 0, pulledCount: 0 };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) {
    return { mode: 'AUTH_REQUIRED', pushedCount: 0, pulledCount: 0 };
  }

  // 1. Push pending local changes first
  const pushResult = await flushSyncOutboxToCloud();

  // 2. Determine user's club memberships
  const { data: myMemberships, error: memberErr } = await supabase
    .from('club_members')
    .select('id, club_id')
    .eq('user_id', user.id);

  if (memberErr) {
    return {
      mode: 'CLOUD',
      pushedCount: pushResult.flushedCount,
      pulledCount: 0,
      errorMessage: memberErr.message
    };
  }

  if (!myMemberships || myMemberships.length === 0) {
    // Membership removed (e.g. via Vereins-Reset): drop stale cached cloud club data
    const demoClubPresent = await db.clubs.get('club-sgh-1');
    if (!demoClubPresent && (await db.clubs.count()) > 0) {
      await clearAllLocalDatabaseTables();
    }
    return {
      mode: 'NO_CLUB',
      pushedCount: pushResult.flushedCount,
      pulledCount: 0
    };
  }

  const clubIds = Array.from(new Set(myMemberships.map((m) => m.club_id as string)));

  // If local DB currently holds demo seed data, wipe it before loading real cloud club data
  const demoClub = await db.clubs.get('club-sgh-1');
  if (demoClub) {
    await clearAllLocalDatabaseTables();
  }

  // 3. Pull club-scoped tables (paginated so > 1,000 rows are never truncated)
  const [clubsRes, membersRes, teamsRes, exercisesRes, templatesRes] = await Promise.all([
    fetchAllByInFilter<Club>(supabase, 'clubs', 'id', clubIds),
    fetchAllByInFilter<ClubMember>(supabase, 'club_members', 'club_id', clubIds),
    fetchAllByInFilter<Team>(supabase, 'teams', 'club_id', clubIds),
    fetchAllPaginated<Exercise>((from, to) =>
      supabase
        .from('exercises')
        .select('*')
        .or(`club_id.in.(${clubIds.join(',')}),visibility.eq.PUBLIC`)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllByInFilter<SessionTemplate>(supabase, 'session_templates', 'club_id', clubIds)
  ]);

  const pullErrors: string[] = [];
  const collectPullError = (res: { error: { message: string } | null }) => {
    if (res.error) pullErrors.push(res.error.message);
  };
  [clubsRes, membersRes, teamsRes, exercisesRes, templatesRes].forEach(collectPullError);

  const remoteClubs = clubsRes.data;
  const remoteMembers = membersRes.data;
  const remoteTeams = teamsRes.data;
  const remoteExercises = exercisesRes.data;
  const remoteTemplates = templatesRes.data;

  const teamIds = remoteTeams.map((t) => t.id);

  let remoteTeamMembers: TeamMember[] = [];
  let remotePlans: MultiWeekPlan[] = [];
  let remoteSessions: TrainingSession[] = [];

  if (teamIds.length > 0) {
    const [tmRes, plansRes, sessionsRes] = await Promise.all([
      fetchAllByInFilter<TeamMember>(supabase, 'team_members', 'team_id', teamIds),
      fetchAllByInFilter<MultiWeekPlan>(supabase, 'multi_week_plans', 'team_id', teamIds),
      fetchAllByInFilter<TrainingSession>(supabase, 'training_sessions', 'team_id', teamIds)
    ]);
    [tmRes, plansRes, sessionsRes].forEach(collectPullError);
    remoteTeamMembers = tmRes.data;
    remotePlans = plansRes.data;
    remoteSessions = sessionsRes.data;
  }

  const planIds = remotePlans.map((p) => p.id);
  let remotePlanWeeks: PlanWeek[] = [];
  if (planIds.length > 0) {
    const pwRes = await fetchAllByInFilter<PlanWeek>(
      supabase,
      'plan_weeks',
      'multi_week_plan_id',
      planIds
    );
    collectPullError(pwRes);
    remotePlanWeeks = pwRes.data;
  }

  const sessionIds = remoteSessions.map((s) => s.id);
  let remotePhases: SessionPhase[] = [];
  let remoteNotes: SessionNote[] = [];
  if (sessionIds.length > 0) {
    const [phasesRes, notesRes] = await Promise.all([
      fetchAllByInFilter<SessionPhase>(supabase, 'session_phases', 'training_session_id', sessionIds),
      fetchAllByInFilter<SessionNote>(supabase, 'session_notes', 'training_session_id', sessionIds)
    ]);
    [phasesRes, notesRes].forEach(collectPullError);
    remotePhases = phasesRes.data;
    remoteNotes = notesRes.data;
  }

  const phaseIds = remotePhases.map((p) => p.id);
  let remoteBlocks: SessionBlock[] = [];
  if (phaseIds.length > 0) {
    const blocksRes = await fetchAllByInFilter<SessionBlock>(
      supabase,
      'session_blocks',
      'session_phase_id',
      phaseIds
    );
    collectPullError(blocksRes);
    remoteBlocks = blocksRes.data;
  }

  // Never merge/prune on partial data
  if (pullErrors.length > 0) {
    return {
      mode: 'CLOUD',
      pushedCount: pushResult.flushedCount,
      pulledCount: 0,
      errorMessage: pullErrors[0]
    };
  }

  // 4. Merge into local IndexedDB while respecting any still-pending local edits
  const stillPending = await db.syncOutbox.where('synced').equals(0).toArray();
  const pendingIds = new Set(stillPending.map((item) => item.entity_id));

  let pulledCount = 0;

  await db.transaction(
    'rw',
    [
      db.clubs,
      db.clubMembers,
      db.teams,
      db.teamMembers,
      db.exercises,
      db.sessionTemplates,
      db.multiWeekPlans,
      db.planWeeks,
      db.trainingSessions,
      db.sessionPhases,
      db.sessionBlocks,
      db.sessionNotes
    ],
    async () => {
      const [
        localClubs,
        localMembers,
        localTeams,
        localExercises,
        localTemplates,
        localPlans,
        localPlanWeeks,
        localSessions,
        localPhases,
        localBlocks,
        localNotes,
        localTeamMembers
      ] = await Promise.all([
        db.clubs.toArray(),
        db.clubMembers.toArray(),
        db.teams.toArray(),
        db.exercises.toArray(),
        db.sessionTemplates.toArray(),
        db.multiWeekPlans.toArray(),
        db.planWeeks.toArray(),
        db.trainingSessions.toArray(),
        db.sessionPhases.toArray(),
        db.sessionBlocks.toArray(),
        db.sessionNotes.toArray(),
        db.teamMembers.toArray()
      ]);

      // Prune rows deleted on the server (other coaches, Vereins-Reset, ...)
      let prunedCount = 0;
      async function prune<T extends { id: string }>(
        table: Table<T, string>,
        localRows: T[],
        remoteRows: T[]
      ) {
        const ids = findDeletedLocalIds(localRows, remoteRows, pendingIds);
        if (ids.length) {
          await table.bulkDelete(ids);
          prunedCount += ids.length;
        }
      }
      await prune(db.sessionNotes, localNotes, remoteNotes);
      await prune(db.sessionBlocks, localBlocks, remoteBlocks);
      await prune(db.sessionPhases, localPhases, remotePhases);
      await prune(db.trainingSessions, localSessions, remoteSessions);
      await prune(db.planWeeks, localPlanWeeks, remotePlanWeeks);
      await prune(db.multiWeekPlans, localPlans, remotePlans);
      await prune(db.sessionTemplates, localTemplates, remoteTemplates);
      await prune(db.exercises, localExercises, remoteExercises);
      await prune(db.teamMembers, localTeamMembers, remoteTeamMembers);
      await prune(db.teams, localTeams, remoteTeams);
      await prune(db.clubMembers, localMembers, remoteMembers);
      await prune(db.clubs, localClubs, remoteClubs);

      const clubsToPut = mergeByUpdatedAt(localClubs, remoteClubs, pendingIds);
      const membersToPut = mergeByUpdatedAt(localMembers, remoteMembers, pendingIds);
      const teamsToPut = mergeByUpdatedAt(localTeams, remoteTeams, pendingIds);
      const exercisesToPut = mergeByUpdatedAt(localExercises, remoteExercises, pendingIds);
      const templatesToPut = mergeByUpdatedAt(localTemplates, remoteTemplates, pendingIds);
      const plansToPut = mergeByUpdatedAt(localPlans, remotePlans, pendingIds);
      const weeksToPut = mergeByUpdatedAt(localPlanWeeks, remotePlanWeeks, pendingIds);
      const sessionsToPut = mergeByUpdatedAt(localSessions, remoteSessions, pendingIds);
      const phasesToPut = mergeByUpdatedAt(localPhases, remotePhases, pendingIds);
      const blocksToPut = mergeByUpdatedAt(localBlocks, remoteBlocks, pendingIds);
      const notesToPut = mergeByUpdatedAt(localNotes, remoteNotes, pendingIds);
      const teamMembersToPut = remoteTeamMembers.filter((tm) => !pendingIds.has(tm.id));

      if (clubsToPut.length) await db.clubs.bulkPut(clubsToPut);
      if (membersToPut.length) await db.clubMembers.bulkPut(membersToPut);
      if (teamsToPut.length) await db.teams.bulkPut(teamsToPut);
      if (teamMembersToPut.length) await db.teamMembers.bulkPut(teamMembersToPut);
      if (exercisesToPut.length) await db.exercises.bulkPut(exercisesToPut);
      if (templatesToPut.length) await db.sessionTemplates.bulkPut(templatesToPut);
      if (plansToPut.length) await db.multiWeekPlans.bulkPut(plansToPut);
      if (weeksToPut.length) await db.planWeeks.bulkPut(weeksToPut);
      if (sessionsToPut.length) await db.trainingSessions.bulkPut(sessionsToPut);
      if (phasesToPut.length) await db.sessionPhases.bulkPut(phasesToPut);
      if (blocksToPut.length) await db.sessionBlocks.bulkPut(blocksToPut);
      if (notesToPut.length) await db.sessionNotes.bulkPut(notesToPut);

      pulledCount =
        clubsToPut.length +
        membersToPut.length +
        teamsToPut.length +
        teamMembersToPut.length +
        exercisesToPut.length +
        templatesToPut.length +
        plansToPut.length +
        weeksToPut.length +
        sessionsToPut.length +
        phasesToPut.length +
        blocksToPut.length +
        notesToPut.length +
        prunedCount;
    }
  );

  setLastSyncedAt(new Date().toISOString());

  const errorMessage =
    pushResult.failedCount > 0
      ? `${pushResult.failedCount} Änderung(en) nicht gesendet (${pushResult.lastErrorMessage ?? 'Unbekannter Fehler'}) · ${pushResult.flushedCount} gesendet, ${pulledCount} aktualisiert.`
      : undefined;

  return {
    mode: 'CLOUD',
    pushedCount: pushResult.flushedCount,
    pulledCount,
    errorMessage
  };
}

/**
 * Exports the entire local club database as a JSON string for backup or manual device transfer.
 */
export async function exportClubDatabaseSnapshot(): Promise<string> {
  const [
    clubs,
    clubMembers,
    teams,
    teamMembers,
    exercises,
    sessionTemplates,
    multiWeekPlans,
    planWeeks,
    trainingSessions,
    sessionPhases,
    sessionBlocks,
    sessionNotes
  ] = await Promise.all([
    db.clubs.toArray(),
    db.clubMembers.toArray(),
    db.teams.toArray(),
    db.teamMembers.toArray(),
    db.exercises.toArray(),
    db.sessionTemplates.toArray(),
    db.multiWeekPlans.toArray(),
    db.planWeeks.toArray(),
    db.trainingSessions.toArray(),
    db.sessionPhases.toArray(),
    db.sessionBlocks.toArray(),
    db.sessionNotes.toArray()
  ]);

  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      clubs,
      clubMembers,
      teams,
      teamMembers,
      exercises,
      sessionTemplates,
      multiWeekPlans,
      planWeeks,
      trainingSessions,
      sessionPhases,
      sessionBlocks,
      sessionNotes
    },
    null,
    2
  );
}
