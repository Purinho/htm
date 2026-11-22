import Dexie, { type Table } from 'dexie';
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

export class HandballTrainingDB extends Dexie {
  clubs!: Table<Club, string>;
  clubMembers!: Table<ClubMember, string>;
  teams!: Table<Team, string>;
  teamMembers!: Table<TeamMember, string>;
  exercises!: Table<Exercise, string>;
  sessionTemplates!: Table<SessionTemplate, string>;
  multiWeekPlans!: Table<MultiWeekPlan, string>;
  planWeeks!: Table<PlanWeek, string>;
  trainingSessions!: Table<TrainingSession, string>;
  sessionPhases!: Table<SessionPhase, string>;
  sessionBlocks!: Table<SessionBlock, string>;
  sessionNotes!: Table<SessionNote, string>;
  syncOutbox!: Table<SyncOutboxItem, number>;

  constructor() {
    super('HandballTrainingManagementDB');

    this.version(1).stores({
      clubs: 'id, invite_code, updated_at',
      clubMembers: 'id, club_id, club_role, updated_at',
      teams: 'id, club_id, is_archived, updated_at',
      teamMembers: 'id, team_id, club_member_id, [team_id+club_member_id]',
      exercises: 'id, club_id, parent_exercise_id, visibility, owner_team_id, is_deleted, updated_at',
      sessionTemplates: 'id, club_id, updated_at',
      multiWeekPlans: 'id, team_id, start_date, updated_at',
      planWeeks: 'id, multi_week_plan_id, week_number, start_date',
      trainingSessions: 'id, team_id, plan_week_id, session_date, status, updated_at',
      sessionPhases: 'id, training_session_id, sort_order',
      sessionBlocks: 'id, session_phase_id, exercise_id, time_slot_index, assigned_member_id',
      sessionNotes: 'id, training_session_id, session_block_id, author_member_id, created_at',
      syncOutbox: '++id, entity_table, entity_id, synced, created_at'
    });

    this.version(2).stores({
      exercises: 'id, club_id, parent_exercise_id, visibility, owner_team_id, is_favorite, is_deleted, updated_at'
    });
  }
}

export const db = new HandballTrainingDB();

/**
 * Records a local change in the Sync-Outbox so it can be pushed to Supabase
 * whenever an internet connection & cloud credentials are available.
 */
export async function queueSyncOperation(
  entityTable: string,
  entityId: string,
  operation: 'UPSERT' | 'DELETE',
  payload: unknown
): Promise<void> {
  await db.syncOutbox.add({
    entity_table: entityTable,
    entity_id: entityId,
    operation,
    payload_json: JSON.stringify(payload),
    created_at: new Date().toISOString(),
    synced: 0
  });
}

/**
 * Removes pending UPSERT outbox entries for entities that were deleted locally
 * (e.g., via cascading session or team deletes) so orphaned child records are never
 * pushed after their parent is gone.
 */
export async function purgePendingOutboxUpserts(entityKeys: Set<string>): Promise<void> {
  if (entityKeys.size === 0) return;
  const pending = await db.syncOutbox.where('synced').equals(0).toArray();
  const idsToDelete: number[] = [];
  for (const item of pending) {
    if (
      item.id !== undefined &&
      item.operation === 'UPSERT' &&
      entityKeys.has(`${item.entity_table}:${item.entity_id}`)
    ) {
      idsToDelete.push(item.id);
    }
  }
  if (idsToDelete.length > 0) {
    await db.syncOutbox.bulkDelete(idsToDelete);
  }
}
