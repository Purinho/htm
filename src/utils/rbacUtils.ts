import type { ClubMember, Exercise, Team, TeamMember } from '../types/domain';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): boolean {
  return Boolean(value && UUID_REGEX.test(value));
}

export interface ClubAccessContext {
  isLocalDemoMode: boolean;
  isClubAdmin: boolean;
  currentMember?: ClubMember;
  assignedTeamIds: Set<string>;
}

export interface ResolveClubAccessParams {
  supabaseConfigured: boolean;
  authUserId: string | null;
  activeClubId?: string | null;
  members: ClubMember[];
  teamMembers: TeamMember[];
}

/**
 * Resolves the effective RBAC context for the current user within the active club.
 *
 * Fail-closed in cloud mode: when Supabase is configured and the active club is a
 * real cloud UUID while `authUserId` is null (e.g. startup or expired session),
 * `isLocalDemoMode` and `isClubAdmin` both evaluate to `false`.
 */
export function resolveClubAccessContext({
  supabaseConfigured,
  authUserId,
  activeClubId,
  members,
  teamMembers
}: ResolveClubAccessParams): ClubAccessContext {
  const isLocalDemoMode =
    !supabaseConfigured ||
    (!authUserId && (!activeClubId || activeClubId === 'club-sgh-1' || !isUuid(activeClubId)));

  if (isLocalDemoMode) {
    return {
      isLocalDemoMode: true,
      isClubAdmin: true,
      currentMember: undefined,
      assignedTeamIds: new Set<string>()
    };
  }

  if (!authUserId || !activeClubId) {
    return {
      isLocalDemoMode: false,
      isClubAdmin: false,
      currentMember: undefined,
      assignedTeamIds: new Set<string>()
    };
  }

  const matchingMembers = members.filter(
    (m) => m.club_id === activeClubId && m.user_id === authUserId
  );
  const currentMember =
    matchingMembers.find((m) => m.club_role === 'CLUB_ADMIN') ?? matchingMembers[0];

  if (!currentMember) {
    return {
      isLocalDemoMode: false,
      isClubAdmin: false,
      currentMember: undefined,
      assignedTeamIds: new Set<string>()
    };
  }

  const assignedTeamIds = new Set(
    teamMembers
      .filter((tm) => tm.club_member_id === currentMember.id)
      .map((tm) => tm.team_id)
  );

  return {
    isLocalDemoMode: false,
    isClubAdmin: currentMember.club_role === 'CLUB_ADMIN',
    currentMember,
    assignedTeamIds
  };
}

export function canManageClub(ctx: ClubAccessContext): boolean {
  return ctx.isClubAdmin;
}

export function canManageSessionTemplates(ctx: ClubAccessContext): boolean {
  return ctx.isClubAdmin;
}

export function canEditTeamContent(ctx: ClubAccessContext, teamId?: string | null): boolean {
  if (ctx.isClubAdmin) return true;
  return Boolean(teamId && ctx.assignedTeamIds.has(teamId));
}

export function canCreateTeamExercise(ctx: ClubAccessContext, teamId?: string | null): boolean {
  return canEditTeamContent(ctx, teamId);
}

export function canEditOrDeleteExercise(ctx: ClubAccessContext, exercise: Exercise): boolean {
  if (exercise.visibility === 'PUBLIC') {
    return false;
  }
  if (ctx.isClubAdmin) {
    return true;
  }
  if (ctx.currentMember && exercise.created_by_member_id === ctx.currentMember.id) {
    return true;
  }
  if (
    exercise.visibility === 'TEAM' &&
    exercise.owner_team_id &&
    ctx.assignedTeamIds.has(exercise.owner_team_id)
  ) {
    return true;
  }
  return false;
}

export function selectDefaultTeamForUser(
  teams: Team[],
  ctx: ClubAccessContext,
  currentTeamId?: string
): Team | undefined {
  if (currentTeamId) {
    const matched = teams.find((t) => t.id === currentTeamId);
    if (matched) return matched;
  }
  if (!ctx.isClubAdmin) {
    const firstAssigned = teams.find((t) => ctx.assignedTeamIds.has(t.id));
    if (firstAssigned) return firstAssigned;
  }
  return teams[0];
}
