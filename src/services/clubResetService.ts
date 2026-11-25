import { db } from '../db/database';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { isValidUuid } from './cloudSyncService';
import { generateSecureInviteCode } from '../utils/securityUtils';
import {
  computeClubResetScope,
  hasAnyResetSelection,
  resolvePreservedAdminMemberId,
  type ClubResetResult,
  type ClubResetScope,
  type ClubResetSelection
} from '../utils/clubResetUtils';
import type { Club } from '../types/domain';

interface ExecuteClubResetParams {
  club: Club;
  selection: ClubResetSelection;
  authUserId: string | null;
  isClubAdmin: boolean;
}

/**
 * Executes the admin-only Vereins-Reset.
 * - Cloud mode: atomic server-side RPC `reset_club_data`, then local IndexedDB cleanup.
 * - Local / demo mode: everything inside one Dexie transaction.
 */
export async function executeClubReset({
  club,
  selection,
  authUserId,
  isClubAdmin
}: ExecuteClubResetParams): Promise<ClubResetResult> {
  if (!isClubAdmin) {
    throw new Error(
      'Keine Berechtigung: Nur Vereins-Administratoren dürfen den Vereins-Reset ausführen.'
    );
  }
  if (!hasAnyResetSelection(selection)) {
    throw new Error('Bitte mindestens einen Bereich zum Zurücksetzen auswählen.');
  }

  const isCloudClub = isSupabaseConfigured() && Boolean(authUserId) && isValidUuid(club.id);

  if (isCloudClub) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(
        'Für den Vereins-Reset im Cloud-Modus wird eine aktive Internetverbindung benötigt.'
      );
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Bitte zuerst im Cloud-Konto anmelden.');
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Bitte zuerst im Cloud-Konto anmelden.');
    }

    const { data, error } = await supabase.rpc('reset_club_data', {
      p_club_id: club.id,
      p_delete_exercises: selection.deleteExercises,
      p_delete_sessions: selection.deleteSessions,
      p_delete_plans: selection.deletePlans,
      p_delete_members: selection.deleteMembers
    });

    if (error) {
      const msg = error.message ?? '';
      const isMissingFunction =
        error.code === 'PGRST202' ||
        (/reset_club_data/i.test(msg) &&
          /(could not find|does not exist|schema cache)/i.test(msg));
      if (isMissingFunction) {
        throw new Error(
          'Die Server-Funktion "reset_club_data" fehlt noch in Supabase. Bitte zuerst die Migration 0005_club_reset_rpc.sql im Supabase SQL-Editor ausführen.'
        );
      }
      throw new Error(msg || 'Vereins-Reset auf dem Server fehlgeschlagen.');
    }

    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const num = (key: string): number => {
      const value = Number(payload[key] ?? 0);
      return Number.isFinite(value) ? value : 0;
    };
    const rpcNewInviteCode =
      typeof payload.new_invite_code === 'string' ? payload.new_invite_code : undefined;

    await applyLocalClubReset(club, selection, authUserId, rpcNewInviteCode);

    return {
      mode: 'CLOUD',
      clubId: club.id,
      deletedExercises: num('deleted_exercises'),
      deletedSessions: num('deleted_sessions'),
      deletedPlans: num('deleted_plans'),
      deletedMembers: num('deleted_members'),
      deletedTeamMembers: num('deleted_team_members'),
      newInviteCode: rpcNewInviteCode
    };
  }

  const newInviteCode = selection.deleteMembers ? generateSecureInviteCode(club.name) : undefined;
  const scope = await applyLocalClubReset(club, selection, authUserId, newInviteCode);

  return {
    mode: 'LOCAL',
    clubId: club.id,
    deletedExercises: scope.activeExercisesToDeleteCount,
    deletedSessions: scope.sessionIdsToDelete.length,
    deletedPlans: scope.planIdsToDelete.length,
    deletedMembers: scope.memberIdsToDelete.length,
    deletedTeamMembers: scope.teamMemberIdsToDelete.length,
    newInviteCode
  };
}

async function applyLocalClubReset(
  club: Club,
  selection: ClubResetSelection,
  authUserId: string | null,
  newInviteCode: string | undefined
): Promise<ClubResetScope> {
  let scope: ClubResetScope | null = null;

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
      const [
        teams,
        clubMembers,
        teamMembers,
        exercises,
        templates,
        plans,
        planWeeks,
        sessions,
        phases,
        blocks,
        notes
      ] = await Promise.all([
        db.teams.toArray(),
        db.clubMembers.toArray(),
        db.teamMembers.toArray(),
        db.exercises.toArray(), // intentionally includes soft-deleted exercises
        db.sessionTemplates.toArray(),
        db.multiWeekPlans.toArray(),
        db.planWeeks.toArray(),
        db.trainingSessions.toArray(),
        db.sessionPhases.toArray(),
        db.sessionBlocks.toArray(),
        db.sessionNotes.toArray()
      ]);

      const nowIso = new Date().toISOString();
      const computed = computeClubResetScope({
        clubId: club.id,
        selection,
        preservedAdminMemberId: resolvePreservedAdminMemberId(clubMembers, club.id, authUserId),
        data: {
          teams,
          clubMembers,
          teamMembers,
          exercises,
          templates,
          plans,
          planWeeks,
          sessions,
          phases,
          blocks,
          notes
        },
        nowIso
      });
      scope = computed;

      if (computed.blockIdsToDelete.length) await db.sessionBlocks.bulkDelete(computed.blockIdsToDelete);
      if (computed.noteIdsToDelete.length) await db.sessionNotes.bulkDelete(computed.noteIdsToDelete);
      if (computed.phaseIdsToDelete.length) await db.sessionPhases.bulkDelete(computed.phaseIdsToDelete);
      if (computed.sessionIdsToDelete.length)
        await db.trainingSessions.bulkDelete(computed.sessionIdsToDelete);
      if (computed.planWeekIdsToDelete.length)
        await db.planWeeks.bulkDelete(computed.planWeekIdsToDelete);
      if (computed.planIdsToDelete.length) await db.multiWeekPlans.bulkDelete(computed.planIdsToDelete);
      if (computed.teamMemberIdsToDelete.length)
        await db.teamMembers.bulkDelete(computed.teamMemberIdsToDelete);
      if (computed.memberIdsToDelete.length) await db.clubMembers.bulkDelete(computed.memberIdsToDelete);
      if (computed.exerciseIdsToDelete.length)
        await db.exercises.bulkDelete(computed.exerciseIdsToDelete);

      if (computed.sessionsToUpdate.length) await db.trainingSessions.bulkPut(computed.sessionsToUpdate);
      if (computed.blocksToUpdate.length) await db.sessionBlocks.bulkPut(computed.blocksToUpdate);
      if (computed.notesToUpdate.length) await db.sessionNotes.bulkPut(computed.notesToUpdate);
      if (computed.exercisesToUpdate.length) await db.exercises.bulkPut(computed.exercisesToUpdate);
      if (computed.templatesToUpdate.length)
        await db.sessionTemplates.bulkPut(computed.templatesToUpdate);

      if (selection.deleteMembers && newInviteCode) {
        await db.clubs.update(club.id, { invite_code: newInviteCode, updated_at: nowIso });
      }

      // Purge / rewrite pending outbox items so stale offline edits cannot resurrect data
      const updatedEntitiesByKey = new Map<string, unknown>();
      for (const s of computed.sessionsToUpdate) updatedEntitiesByKey.set(`training_sessions:${s.id}`, s);
      for (const b of computed.blocksToUpdate) updatedEntitiesByKey.set(`session_blocks:${b.id}`, b);
      for (const n of computed.notesToUpdate) updatedEntitiesByKey.set(`session_notes:${n.id}`, n);
      for (const e of computed.exercisesToUpdate) updatedEntitiesByKey.set(`exercises:${e.id}`, e);
      for (const t of computed.templatesToUpdate) updatedEntitiesByKey.set(`session_templates:${t.id}`, t);

      const pending = await db.syncOutbox.where('synced').equals(0).toArray();
      const outboxIdsToDelete: number[] = [];
      for (const item of pending) {
        if (item.id === undefined) continue;
        const key = `${item.entity_table}:${item.entity_id}`;
        if (computed.outboxEntityKeysToPurge.has(key)) {
          outboxIdsToDelete.push(item.id);
          continue;
        }

        if (item.operation === 'UPSERT' && updatedEntitiesByKey.has(key)) {
          await db.syncOutbox.update(item.id, {
            payload_json: JSON.stringify(updatedEntitiesByKey.get(key))
          });
          continue;
        }

        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(item.payload_json) as Record<string, unknown>;
        } catch {
          parsed = null;
        }

        if (
          selection.deleteExercises &&
          item.entity_table === 'exercises' &&
          parsed &&
          parsed.club_id === club.id &&
          parsed.visibility !== 'PUBLIC'
        ) {
          outboxIdsToDelete.push(item.id);
          continue;
        }

        if (
          selection.deleteMembers &&
          newInviteCode &&
          item.entity_table === 'clubs' &&
          item.entity_id === club.id &&
          parsed
        ) {
          await db.syncOutbox.update(item.id, {
            payload_json: JSON.stringify({ ...parsed, invite_code: newInviteCode })
          });
        }
      }
      if (outboxIdsToDelete.length) await db.syncOutbox.bulkDelete(outboxIdsToDelete);
    }
  );

  if (!scope) {
    throw new Error('Vereins-Reset konnte lokal nicht ausgeführt werden.');
  }
  return scope;
}
