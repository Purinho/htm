-- ============================================================================
-- Handball Training Management – RBAC Hardening (Migration 0006)
-- Run this migration AFTER 0005_club_reset_rpc.sql in Supabase SQL Editor.
--
-- Enforces strict separation between CLUB_ADMIN and COACH:
--   1. Club settings, teams, team_members & session_templates: CLUB_ADMIN only
--      for writes/deletes; COACH has read-only access within their club.
--   2. Multi-week plans, plan weeks, training sessions, phases, blocks & notes:
--      CLUB_ADMIN has full access; COACH has write/delete access ONLY for teams
--      they are assigned to via team_members, and read-only access for other teams.
--   3. Exercises:
--      - PUBLIC exercises remain read-only for all club users.
--      - CLUB_ADMIN can create/edit/delete all CLUB & TEAM exercises in their club.
--      - COACH can create CLUB exercises and TEAM exercises for assigned teams,
--        and edit/delete only their own exercises or TEAM exercises of assigned teams.
--      - A BEFORE INSERT OR UPDATE trigger prevents spoofing created_by_member_id.
-- ============================================================================

-- 1. Security-definer helper functions
create or replace function public.get_my_club_member_id(target_club_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.id
  from public.club_members cm
  where cm.club_id = target_club_id
    and cm.user_id = auth.uid()
  order by (cm.club_role = 'CLUB_ADMIN') desc, cm.created_at asc
  limit 1;
$$;

create or replace function public.is_my_club_member(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_member_id is not null and exists (
    select 1
    from public.club_members cm
    where cm.id = target_member_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null and exists (
    select 1
    from public.team_members tm
    join public.club_members cm on cm.id = tm.club_member_id
    where tm.team_id = target_team_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_team(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null and (
    public.is_club_admin(public.get_club_id_for_team(target_team_id))
    or public.is_team_member(target_team_id)
  );
$$;

create or replace function public.get_team_id_for_plan(target_plan_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.team_id
  from public.multi_week_plans p
  where p.id = target_plan_id
  limit 1;
$$;

create or replace function public.get_team_id_for_session(target_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.team_id
  from public.training_sessions s
  where s.id = target_session_id
  limit 1;
$$;

create or replace function public.get_team_id_for_phase(target_phase_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.team_id
  from public.session_phases sp
  join public.training_sessions s on s.id = sp.training_session_id
  where sp.id = target_phase_id
  limit 1;
$$;

create or replace function public.can_write_exercise(
  p_club_id uuid,
  p_visibility text,
  p_owner_team_id uuid,
  p_created_by_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_visibility in ('CLUB', 'TEAM')
    and (
      public.is_club_admin(p_club_id)
      or (
        public.is_club_member(p_club_id)
        and (
          (p_visibility = 'CLUB' and public.is_my_club_member(p_created_by_member_id))
          or (
            p_visibility = 'TEAM'
            and (
              (p_owner_team_id is not null and public.is_team_member(p_owner_team_id))
              or public.is_my_club_member(p_created_by_member_id)
            )
          )
        )
      )
    );
$$;

-- 2. Trigger to enforce created_by_member_id & prevent ownership spoofing by COACH
create or replace function public.enforce_exercise_creator_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip enforcement for direct SQL-editor / service-role operations without auth.uid()
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.is_club_admin(new.club_id) then
      new.created_by_member_id := public.get_my_club_member_id(new.club_id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not public.is_club_admin(old.club_id) then
      new.club_id := old.club_id;
      new.created_by_member_id := old.created_by_member_id;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_exercises_enforce_creator on public.exercises;
create trigger trg_exercises_enforce_creator
  before insert or update on public.exercises
  for each row
  execute function public.enforce_exercise_creator_ownership();

-- 3. Tightened RLS Policies

-- CLUBS
drop policy if exists "clubs_update_admin" on public.clubs;
create policy "clubs_update_admin" on public.clubs
  for update using (public.is_club_admin(id))
  with check (public.is_club_admin(id));

-- TEAMS (CLUB_ADMIN only for INSERT / UPDATE / DELETE; all club members can SELECT)
drop policy if exists "teams_write_member" on public.teams;
drop policy if exists "teams_insert_update_member" on public.teams;
drop policy if exists "teams_update_member" on public.teams;
drop policy if exists "teams_delete_admin" on public.teams;
drop policy if exists "teams_insert_admin" on public.teams;
drop policy if exists "teams_update_admin" on public.teams;

create policy "teams_insert_admin" on public.teams
  for insert with check (public.is_club_admin(club_id));

create policy "teams_update_admin" on public.teams
  for update using (public.is_club_admin(club_id))
  with check (public.is_club_admin(club_id));

create policy "teams_delete_admin" on public.teams
  for delete using (public.is_club_admin(club_id));

-- TEAM MEMBERS (CLUB_ADMIN only for INSERT / UPDATE / DELETE; all club members can SELECT)
drop policy if exists "team_members_all_member" on public.team_members;
drop policy if exists "team_members_select_member" on public.team_members;
drop policy if exists "team_members_insert_admin" on public.team_members;
drop policy if exists "team_members_update_admin" on public.team_members;
drop policy if exists "team_members_delete_admin" on public.team_members;

create policy "team_members_select_member" on public.team_members
  for select using (public.is_club_member(public.get_club_id_for_team(team_id)));

create policy "team_members_insert_admin" on public.team_members
  for insert with check (public.is_club_admin(public.get_club_id_for_team(team_id)));

create policy "team_members_update_admin" on public.team_members
  for update using (public.is_club_admin(public.get_club_id_for_team(team_id)))
  with check (public.is_club_admin(public.get_club_id_for_team(team_id)));

create policy "team_members_delete_admin" on public.team_members
  for delete using (public.is_club_admin(public.get_club_id_for_team(team_id)));

-- EXERCISES
drop policy if exists "exercises_write_member" on public.exercises;
drop policy if exists "exercises_insert_member" on public.exercises;
drop policy if exists "exercises_update_authorized" on public.exercises;
drop policy if exists "exercises_delete_authorized" on public.exercises;

create policy "exercises_insert_member" on public.exercises
  for insert with check (
    public.is_club_member(club_id)
    and visibility in ('CLUB', 'TEAM')
    and (
      public.is_club_admin(club_id)
      or (
        (created_by_member_id is null or public.is_my_club_member(created_by_member_id))
        and (
          visibility = 'CLUB'
          or (
            visibility = 'TEAM'
            and owner_team_id is not null
            and public.is_team_member(owner_team_id)
          )
        )
      )
    )
  );

create policy "exercises_update_authorized" on public.exercises
  for update using (
    public.can_write_exercise(club_id, visibility, owner_team_id, created_by_member_id)
  )
  with check (
    public.can_write_exercise(club_id, visibility, owner_team_id, created_by_member_id)
  );

create policy "exercises_delete_authorized" on public.exercises
  for delete using (
    public.can_write_exercise(club_id, visibility, owner_team_id, created_by_member_id)
  );

-- SESSION TEMPLATES (CLUB_ADMIN only for INSERT / UPDATE / DELETE; all club members can SELECT)
drop policy if exists "session_templates_all_member" on public.session_templates;
drop policy if exists "session_templates_select_member" on public.session_templates;
drop policy if exists "session_templates_insert_admin" on public.session_templates;
drop policy if exists "session_templates_update_admin" on public.session_templates;
drop policy if exists "session_templates_delete_admin" on public.session_templates;

create policy "session_templates_select_member" on public.session_templates
  for select using (public.is_club_member(club_id));

create policy "session_templates_insert_admin" on public.session_templates
  for insert with check (public.is_club_admin(club_id));

create policy "session_templates_update_admin" on public.session_templates
  for update using (public.is_club_admin(club_id))
  with check (public.is_club_admin(club_id));

create policy "session_templates_delete_admin" on public.session_templates
  for delete using (public.is_club_admin(club_id));

-- MULTI WEEK PLANS (Read for club members; Write/Delete for CLUB_ADMIN or assigned team_member)
drop policy if exists "multi_week_plans_all_member" on public.multi_week_plans;
drop policy if exists "multi_week_plans_select_member" on public.multi_week_plans;
drop policy if exists "multi_week_plans_insert_team" on public.multi_week_plans;
drop policy if exists "multi_week_plans_update_team" on public.multi_week_plans;
drop policy if exists "multi_week_plans_delete_team" on public.multi_week_plans;

create policy "multi_week_plans_select_member" on public.multi_week_plans
  for select using (public.is_club_member(public.get_club_id_for_team(team_id)));

create policy "multi_week_plans_insert_team" on public.multi_week_plans
  for insert with check (public.can_edit_team(team_id));

create policy "multi_week_plans_update_team" on public.multi_week_plans
  for update using (public.can_edit_team(team_id))
  with check (public.can_edit_team(team_id));

create policy "multi_week_plans_delete_team" on public.multi_week_plans
  for delete using (public.can_edit_team(team_id));

-- PLAN WEEKS
drop policy if exists "plan_weeks_all_member" on public.plan_weeks;
drop policy if exists "plan_weeks_select_member" on public.plan_weeks;
drop policy if exists "plan_weeks_insert_team" on public.plan_weeks;
drop policy if exists "plan_weeks_update_team" on public.plan_weeks;
drop policy if exists "plan_weeks_delete_team" on public.plan_weeks;

create policy "plan_weeks_select_member" on public.plan_weeks
  for select using (public.is_club_member(public.get_club_id_for_plan(multi_week_plan_id)));

create policy "plan_weeks_insert_team" on public.plan_weeks
  for insert with check (public.can_edit_team(public.get_team_id_for_plan(multi_week_plan_id)));

create policy "plan_weeks_update_team" on public.plan_weeks
  for update using (public.can_edit_team(public.get_team_id_for_plan(multi_week_plan_id)))
  with check (public.can_edit_team(public.get_team_id_for_plan(multi_week_plan_id)));

create policy "plan_weeks_delete_team" on public.plan_weeks
  for delete using (public.can_edit_team(public.get_team_id_for_plan(multi_week_plan_id)));

-- TRAINING SESSIONS
drop policy if exists "training_sessions_all_member" on public.training_sessions;
drop policy if exists "training_sessions_select_member" on public.training_sessions;
drop policy if exists "training_sessions_insert_team" on public.training_sessions;
drop policy if exists "training_sessions_update_team" on public.training_sessions;
drop policy if exists "training_sessions_delete_team" on public.training_sessions;

create policy "training_sessions_select_member" on public.training_sessions
  for select using (public.is_club_member(public.get_club_id_for_team(team_id)));

create policy "training_sessions_insert_team" on public.training_sessions
  for insert with check (public.can_edit_team(team_id));

create policy "training_sessions_update_team" on public.training_sessions
  for update using (public.can_edit_team(team_id))
  with check (public.can_edit_team(team_id));

create policy "training_sessions_delete_team" on public.training_sessions
  for delete using (public.can_edit_team(team_id));

-- SESSION PHASES
drop policy if exists "session_phases_all_member" on public.session_phases;
drop policy if exists "session_phases_select_member" on public.session_phases;
drop policy if exists "session_phases_insert_team" on public.session_phases;
drop policy if exists "session_phases_update_team" on public.session_phases;
drop policy if exists "session_phases_delete_team" on public.session_phases;

create policy "session_phases_select_member" on public.session_phases
  for select using (public.is_club_member(public.get_club_id_for_session(training_session_id)));

create policy "session_phases_insert_team" on public.session_phases
  for insert with check (public.can_edit_team(public.get_team_id_for_session(training_session_id)));

create policy "session_phases_update_team" on public.session_phases
  for update using (public.can_edit_team(public.get_team_id_for_session(training_session_id)))
  with check (public.can_edit_team(public.get_team_id_for_session(training_session_id)));

create policy "session_phases_delete_team" on public.session_phases
  for delete using (public.can_edit_team(public.get_team_id_for_session(training_session_id)));

-- SESSION BLOCKS
drop policy if exists "session_blocks_all_member" on public.session_blocks;
drop policy if exists "session_blocks_select_member" on public.session_blocks;
drop policy if exists "session_blocks_insert_team" on public.session_blocks;
drop policy if exists "session_blocks_update_team" on public.session_blocks;
drop policy if exists "session_blocks_delete_team" on public.session_blocks;

create policy "session_blocks_select_member" on public.session_blocks
  for select using (public.is_club_member(public.get_club_id_for_phase(session_phase_id)));

create policy "session_blocks_insert_team" on public.session_blocks
  for insert with check (public.can_edit_team(public.get_team_id_for_phase(session_phase_id)));

create policy "session_blocks_update_team" on public.session_blocks
  for update using (public.can_edit_team(public.get_team_id_for_phase(session_phase_id)))
  with check (public.can_edit_team(public.get_team_id_for_phase(session_phase_id)));

create policy "session_blocks_delete_team" on public.session_blocks
  for delete using (public.can_edit_team(public.get_team_id_for_phase(session_phase_id)));

-- SESSION NOTES
drop policy if exists "session_notes_all_member" on public.session_notes;
drop policy if exists "session_notes_select_member" on public.session_notes;
drop policy if exists "session_notes_insert_team" on public.session_notes;
drop policy if exists "session_notes_update_team" on public.session_notes;
drop policy if exists "session_notes_delete_team" on public.session_notes;

create policy "session_notes_select_member" on public.session_notes
  for select using (public.is_club_member(public.get_club_id_for_session(training_session_id)));

create policy "session_notes_insert_team" on public.session_notes
  for insert with check (public.can_edit_team(public.get_team_id_for_session(training_session_id)));

create policy "session_notes_update_team" on public.session_notes
  for update using (public.can_edit_team(public.get_team_id_for_session(training_session_id)))
  with check (public.can_edit_team(public.get_team_id_for_session(training_session_id)));

create policy "session_notes_delete_team" on public.session_notes
  for delete using (public.can_edit_team(public.get_team_id_for_session(training_session_id)));
