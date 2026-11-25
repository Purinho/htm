import { describe, expect, it } from 'vitest';
import type { ClubMember, Exercise, Team, TeamMember } from '../types/domain';
import {
  canCreateTeamExercise,
  canEditOrDeleteExercise,
  canEditTeamContent,
  canManageClub,
  canManageSessionTemplates,
  resolveClubAccessContext,
  selectDefaultTeamForUser
} from './rbacUtils';

const CLUB_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_CLUB_UUID = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COACH_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_A_ID = '33333333-3333-4333-8333-333333333333';
const TEAM_B_ID = '44444444-4444-4444-8444-444444444444';

function makeMember(overrides: Partial<ClubMember> = {}): ClubMember {
  return {
    id: 'mem-1',
    club_id: CLUB_UUID,
    user_id: COACH_USER_ID,
    club_role: 'COACH',
    display_name: 'Trainer Test',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeTeam(id: string, name: string): Team {
  return {
    id,
    club_id: CLUB_UUID,
    name,
    age_group: 'B_YOUTH',
    season: '2026/27',
    default_schedule: [],
    is_archived: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };
}

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    club_id: CLUB_UUID,
    visibility: 'CLUB',
    title: 'Testübung',
    default_duration_min: 15,
    min_players: 6,
    max_players: 12,
    goalkeepers: 1,
    categories: {
      phases: ['GROUND_EXERCISE'],
      focus: ['OFFENSE_GROUP'],
      level: 'BASIC',
      age_groups: ['B_YOUTH']
    },
    materials: [],
    setup_description: '',
    flow_description: '',
    coaching_points: '',
    variations_text: '',
    external_links: [],
    is_deleted: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('rbacUtils – resolveClubAccessContext', () => {
  it('treats unconfigured Supabase as local demo mode with admin privileges', () => {
    const ctx = resolveClubAccessContext({
      supabaseConfigured: false,
      authUserId: null,
      activeClubId: 'club-sgh-1',
      members: [],
      teamMembers: []
    });

    expect(ctx.isLocalDemoMode).toBe(true);
    expect(ctx.isClubAdmin).toBe(true);
    expect(canManageClub(ctx)).toBe(true);
    expect(canManageSessionTemplates(ctx)).toBe(true);
    expect(canEditTeamContent(ctx, TEAM_A_ID)).toBe(true);
  });

  it('treats demo club without authUserId as local demo mode even when Supabase is configured', () => {
    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: null,
      activeClubId: 'club-sgh-1',
      members: [],
      teamMembers: []
    });

    expect(ctx.isLocalDemoMode).toBe(true);
    expect(ctx.isClubAdmin).toBe(true);
  });

  it('fails closed in cloud mode when activeClubId is a real UUID and authUserId is null', () => {
    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: null,
      activeClubId: CLUB_UUID,
      members: [makeMember({ club_role: 'CLUB_ADMIN', user_id: ADMIN_USER_ID })],
      teamMembers: []
    });

    expect(ctx.isLocalDemoMode).toBe(false);
    expect(ctx.isClubAdmin).toBe(false);
    expect(canManageClub(ctx)).toBe(false);
    expect(canManageSessionTemplates(ctx)).toBe(false);
    expect(canEditTeamContent(ctx, TEAM_A_ID)).toBe(false);
  });

  it('grants full club and team privileges to CLUB_ADMIN in cloud mode', () => {
    const adminMember = makeMember({
      id: 'mem-admin',
      user_id: ADMIN_USER_ID,
      club_role: 'CLUB_ADMIN'
    });
    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: ADMIN_USER_ID,
      activeClubId: CLUB_UUID,
      members: [adminMember],
      teamMembers: []
    });

    expect(ctx.isLocalDemoMode).toBe(false);
    expect(ctx.isClubAdmin).toBe(true);
    expect(ctx.currentMember?.id).toBe('mem-admin');
    expect(canManageClub(ctx)).toBe(true);
    expect(canManageSessionTemplates(ctx)).toBe(true);
    expect(canEditTeamContent(ctx, TEAM_A_ID)).toBe(true);
    expect(canCreateTeamExercise(ctx, TEAM_B_ID)).toBe(true);
  });

  it('restricts COACH to assigned teams and denies club/template admin actions', () => {
    const coachMember = makeMember({
      id: 'mem-coach',
      user_id: COACH_USER_ID,
      club_role: 'COACH'
    });
    const assignments: TeamMember[] = [
      { id: 'tm-1', team_id: TEAM_A_ID, club_member_id: 'mem-coach', team_role: 'HEAD_COACH' }
    ];
    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: COACH_USER_ID,
      activeClubId: CLUB_UUID,
      members: [coachMember],
      teamMembers: assignments
    });

    expect(ctx.isLocalDemoMode).toBe(false);
    expect(ctx.isClubAdmin).toBe(false);
    expect(ctx.currentMember?.id).toBe('mem-coach');
    expect(canManageClub(ctx)).toBe(false);
    expect(canManageSessionTemplates(ctx)).toBe(false);
    expect(canEditTeamContent(ctx, TEAM_A_ID)).toBe(true);
    expect(canEditTeamContent(ctx, TEAM_B_ID)).toBe(false);
    expect(canCreateTeamExercise(ctx, TEAM_A_ID)).toBe(true);
    expect(canCreateTeamExercise(ctx, TEAM_B_ID)).toBe(false);
  });

  it('gives COACH with zero team assignments read-only access on all teams', () => {
    const coachMember = makeMember({
      id: 'mem-coach',
      user_id: COACH_USER_ID,
      club_role: 'COACH'
    });
    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: COACH_USER_ID,
      activeClubId: CLUB_UUID,
      members: [coachMember],
      teamMembers: []
    });

    expect(ctx.isClubAdmin).toBe(false);
    expect(ctx.assignedTeamIds.size).toBe(0);
    expect(canEditTeamContent(ctx, TEAM_A_ID)).toBe(false);
    expect(canCreateTeamExercise(ctx, TEAM_A_ID)).toBe(false);
  });

  it('scopes role lookup strictly to activeClubId', () => {
    const adminOtherClub = makeMember({
      id: 'mem-other-admin',
      club_id: OTHER_CLUB_UUID,
      user_id: COACH_USER_ID,
      club_role: 'CLUB_ADMIN'
    });
    const coachActiveClub = makeMember({
      id: 'mem-active-coach',
      club_id: CLUB_UUID,
      user_id: COACH_USER_ID,
      club_role: 'COACH'
    });

    const ctx = resolveClubAccessContext({
      supabaseConfigured: true,
      authUserId: COACH_USER_ID,
      activeClubId: CLUB_UUID,
      members: [adminOtherClub, coachActiveClub],
      teamMembers: []
    });

    expect(ctx.isClubAdmin).toBe(false);
    expect(ctx.currentMember?.id).toBe('mem-active-coach');
  });
});

describe('rbacUtils – exercise & default team rules', () => {
  const coachCtx = resolveClubAccessContext({
    supabaseConfigured: true,
    authUserId: COACH_USER_ID,
    activeClubId: CLUB_UUID,
    members: [makeMember({ id: 'mem-coach', user_id: COACH_USER_ID, club_role: 'COACH' })],
    teamMembers: [
      { id: 'tm-1', team_id: TEAM_A_ID, club_member_id: 'mem-coach', team_role: 'HEAD_COACH' }
    ]
  });

  const adminCtx = resolveClubAccessContext({
    supabaseConfigured: true,
    authUserId: ADMIN_USER_ID,
    activeClubId: CLUB_UUID,
    members: [makeMember({ id: 'mem-admin', user_id: ADMIN_USER_ID, club_role: 'CLUB_ADMIN' })],
    teamMembers: []
  });

  it('never allows editing or deleting PUBLIC exercises, even for CLUB_ADMIN', () => {
    const pubEx = makeExercise({ visibility: 'PUBLIC' });
    expect(canEditOrDeleteExercise(adminCtx, pubEx)).toBe(false);
    expect(canEditOrDeleteExercise(coachCtx, pubEx)).toBe(false);
  });

  it('allows CLUB_ADMIN to edit/delete any CLUB or TEAM exercise', () => {
    expect(canEditOrDeleteExercise(adminCtx, makeExercise({ visibility: 'CLUB' }))).toBe(true);
    expect(
      canEditOrDeleteExercise(
        adminCtx,
        makeExercise({ visibility: 'TEAM', owner_team_id: TEAM_B_ID, created_by_member_id: 'mem-coach' })
      )
    ).toBe(true);
  });

  it('allows COACH to edit/delete own CLUB exercises, but not foreign/catalog CLUB exercises', () => {
    const ownClubEx = makeExercise({ visibility: 'CLUB', created_by_member_id: 'mem-coach' });
    const foreignClubEx = makeExercise({ visibility: 'CLUB', created_by_member_id: 'mem-admin' });
    const legacyCatalogEx = makeExercise({ visibility: 'CLUB', created_by_member_id: undefined });

    expect(canEditOrDeleteExercise(coachCtx, ownClubEx)).toBe(true);
    expect(canEditOrDeleteExercise(coachCtx, foreignClubEx)).toBe(false);
    expect(canEditOrDeleteExercise(coachCtx, legacyCatalogEx)).toBe(false);
  });

  it('allows COACH to edit/delete TEAM exercises of assigned teams or self-created, but not other teams', () => {
    const assignedTeamEx = makeExercise({
      visibility: 'TEAM',
      owner_team_id: TEAM_A_ID,
      created_by_member_id: 'mem-admin'
    });
    const unassignedTeamEx = makeExercise({
      visibility: 'TEAM',
      owner_team_id: TEAM_B_ID,
      created_by_member_id: 'mem-admin'
    });
    const ownUnassignedTeamEx = makeExercise({
      visibility: 'TEAM',
      owner_team_id: TEAM_B_ID,
      created_by_member_id: 'mem-coach'
    });

    expect(canEditOrDeleteExercise(coachCtx, assignedTeamEx)).toBe(true);
    expect(canEditOrDeleteExercise(coachCtx, unassignedTeamEx)).toBe(false);
    expect(canEditOrDeleteExercise(coachCtx, ownUnassignedTeamEx)).toBe(true);
  });

  it('selects an assigned team first for COACH when currentTeamId is not valid', () => {
    const teamB = makeTeam(TEAM_B_ID, 'Team B');
    const teamA = makeTeam(TEAM_A_ID, 'Team A');
    const teams = [teamB, teamA];

    expect(selectDefaultTeamForUser(teams, coachCtx, 'non-existent')?.id).toBe(TEAM_A_ID);
    expect(selectDefaultTeamForUser(teams, coachCtx, TEAM_B_ID)?.id).toBe(TEAM_B_ID);
    expect(selectDefaultTeamForUser(teams, adminCtx, 'non-existent')?.id).toBe(TEAM_B_ID);
  });
});
