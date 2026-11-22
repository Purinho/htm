export type ClubRole = 'CLUB_ADMIN' | 'COACH';
export type TeamRole = 'HEAD_COACH' | 'ASSISTANT_COACH';
export type VisibilityLevel = 'TEAM' | 'CLUB' | 'PUBLIC';

export type TrainingPhaseCategory =
  | 'WARMUP'
  | 'SMALL_GAME'
  | 'GOALKEEPER_WARMUP'
  | 'GROUND_EXERCISE'
  | 'GROUND_GAME'
  | 'TARGET_GAME'
  | 'ATHLETICS_COORDINATION'
  | 'COOL_DOWN';

export type HandballFocusTag =
  | 'OFFENSE_INDIVIDUAL'
  | 'OFFENSE_GROUP'
  | 'OFFENSE_TEAM'
  | 'DEFENSE_INDIVIDUAL'
  | 'DEFENSE_GROUP'
  | 'DEFENSE_6_0'
  | 'DEFENSE_5_1'
  | 'DEFENSE_3_2_1'
  | 'FAST_BREAK_1ST_WAVE'
  | 'FAST_BREAK_2ND_WAVE'
  | 'RETREAT'
  | 'SHOOTING'
  | 'PASSING_CATCHING'
  | 'GOALKEEPER_TECHNIQUE'
  | 'DRIBBLING'
  | 'PASSING'
  | 'CATCHING'
  | 'JUMP_SHOT'
  | 'STANDING_THROW'
  | 'HIP_UNDERARM_SHOT'
  | 'FALLING_SHOT'
  | 'LOB_SPIN_SHOT'
  | 'FEINT_1V1'
  | 'CROSSING_SCREEN'
  | 'FOOTWORK_DEFENSE'
  | 'ATHLETICS_CONDITIONING'
  | 'REGENERATION_MOBILITY';

export type ComplexityLevel = 'BASIC' | 'ADVANCED' | 'PERFORMANCE';

export type AgeGroup =
  | 'MINIS'
  | 'F_YOUTH'
  | 'E_YOUTH'
  | 'D_YOUTH'
  | 'C_YOUTH'
  | 'B_YOUTH'
  | 'A_YOUTH'
  | 'ADULTS';

export type MaterialType =
  | 'BALL'
  | 'BALL_CART'
  | 'CONE'
  | 'BIBS'
  | 'COORDINATION_LADDER'
  | 'SOFT_MAT'
  | 'POLE_AIRBODY'
  | 'VAULTING_BOX'
  | 'TARGET_CORNER'
  | 'MINI_GOAL';

export interface MaterialItem {
  type: MaterialType;
  quantity: number;
}

export interface ExternalLink {
  title: string;
  url: string;
  platform?: 'YOUTUBE' | 'INSTAGRAM' | 'DHB' | 'WEB';
}

export type CourtTemplate =
  | 'HALF_COURT_VERTICAL'
  | 'HALF_COURT_HORIZONTAL'
  | 'FULL_COURT'
  | 'GOAL_SECTOR_ZOOM'
  | 'FREE_SPACE';

export type TacticNodeType =
  | 'OFFENSE_PLAYER'
  | 'DEFENSE_PLAYER'
  | 'GOALKEEPER'
  | 'COACH_FEEDER'
  | 'EQUIPMENT_CONE'
  | 'EQUIPMENT_MAT'
  | 'EQUIPMENT_GOAL_TARGET'
  | 'WAYPOINT';

export type TacticPathType =
  | 'RUN_PATH'
  | 'PASS_PATH'
  | 'DRIBBLE_PATH'
  | 'SHOT_PATH'
  | 'SCREEN_BLOCK_PATH'
  | 'FEINT_PATH';

export interface TacticNode {
  id: string;
  type: TacticNodeType;
  label?: string;
  x: number; // Normalized 0.0 to 1.0
  y: number; // Normalized 0.0 to 1.0
  color?: string;
  hasBall?: boolean;
  isQueue?: boolean;
  queueCount?: number;
  rotation?: number;
}

export interface TacticZone {
  id: string;
  shape: 'RECT' | 'ELLIPSE';
  x: number; // Normalized center X 0.0 to 1.0
  y: number; // Normalized center Y 0.0 to 1.0
  width: number; // Normalized 0.0 to 1.0
  height: number; // Normalized 0.0 to 1.0
  rotation?: number;
  color: string; // e.g. '#EF4444' or '#22C55E'
  opacity?: number; // Default: 0.22
  label?: string;
}

export interface TacticPathPoint {
  x: number;
  y: number;
}

export interface TacticPath {
  id: string;
  type: TacticPathType;
  stepNumber?: number;
  fromNodeId?: string;
  fromWaypointId?: string;
  toNodeId?: string;
  toWaypointId?: string;
  points: TacticPathPoint[];
  controlPoint?: { x: number; y: number };
  curved?: boolean;
  color?: string;
}

export interface TacticKeyframeNodeState {
  x: number;
  y: number;
  hasBall?: boolean;
  rotation?: number;
  visible?: boolean;
}

export interface TacticKeyframe {
  id: string;
  index: number;
  label?: string;
  durationMs: number;
  pauseAfterMs?: number;
  nodeStates: Record<string, TacticKeyframeNodeState>;
  activePathIds?: string[];
  ballPosition?: {
    holderNodeId?: string;
    x?: number;
    y?: number;
  };
}

export interface TacticBoardAnimationSettings {
  defaultSpeed: 0.5 | 1 | 1.5 | 2;
  loop: boolean;
  showTrails: boolean;
  showPathsDuringPlay: boolean;
}

export interface TacticBoardData {
  version: number;
  courtTemplate: CourtTemplate;
  presetUsed?: string;
  nodes: TacticNode[];
  paths: TacticPath[];
  zones?: TacticZone[];
  keyframes?: TacticKeyframe[];
  animationSettings?: TacticBoardAnimationSettings;
}

export interface Club {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface ClubMember {
  id: string;
  club_id: string;
  user_id?: string;
  club_role: ClubRole;
  display_name: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamScheduleSlot {
  id: string;
  weekday: number; // 1 = Monday ... 7 = Sunday
  weekdayLabel: string;
  startTime: string; // e.g. "18:30"
  endTime: string; // e.g. "20:00"
  hallName?: string;
}

export interface Team {
  id: string;
  club_id: string;
  name: string;
  age_group: string;
  season: string;
  default_schedule: TeamScheduleSlot[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  club_member_id: string;
  team_role: TeamRole;
}

export interface ExerciseCategories {
  phases: TrainingPhaseCategory[];
  focus: HandballFocusTag[];
  level: ComplexityLevel;
  age_groups: AgeGroup[];
}

export interface Exercise {
  id: string;
  club_id: string;
  created_by_member_id?: string;
  parent_exercise_id?: string;
  visibility: VisibilityLevel;
  owner_team_id?: string;
  title: string;
  default_duration_min: number;
  min_players: number;
  max_players: number;
  goalkeepers: number;
  categories: ExerciseCategories;
  materials: MaterialItem[];
  setup_description: string;
  flow_description: string;
  coaching_points: string;
  variations_text: string;
  source_url?: string;
  reference_image_data?: string;
  external_links: ExternalLink[];
  tactic_board_data?: TacticBoardData;
  is_favorite?: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface SessionTemplatePhase {
  name: string;
  target_duration_min: number;
  default_exercise_id?: string;
  default_track_label?: string;
}

export interface SessionTemplate {
  id: string;
  club_id: string;
  title: string;
  description: string;
  default_duration_min: number;
  phases_template: SessionTemplatePhase[];
  updated_at: string;
}

export interface MultiWeekPlan {
  id: string;
  team_id: string;
  title: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  goals: string;
  updated_at: string;
}

export interface PlanWeek {
  id: string;
  multi_week_plan_id: string;
  week_number: number;
  start_date: string; // YYYY-MM-DD
  focus_theme: string;
  focus_tags: HandballFocusTag[];
  color_hex: string;
  notes: string;
  updated_at: string;
}

export type SessionStatus = 'PLANNED' | 'READY' | 'COMPLETED' | 'CANCELLED';

export interface TrainingSession {
  id: string;
  team_id: string;
  plan_week_id?: string;
  session_date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  planned_duration_min: number;
  title: string;
  custom_materials_override: MaterialItem[];
  status: SessionStatus;
  updated_at: string;
}

export interface SessionPhase {
  id: string;
  training_session_id: string;
  name: string;
  sort_order: number;
  target_duration_min: number;
  updated_at: string;
}

export interface SessionBlock {
  id: string;
  session_phase_id: string;
  exercise_id?: string;
  quick_block_title?: string;
  quick_block_description?: string;
  time_slot_index: number; // Same index within phase = Parallel execution!
  track_label: string; // e.g. "Alle", "Gruppe A (Feld)", "Torhüter"
  assigned_member_id?: string;
  custom_duration_min: number;
  updated_at: string;
}

export interface SessionNote {
  id: string;
  training_session_id: string;
  session_block_id?: string;
  author_member_id?: string;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface SyncOutboxItem {
  id?: number;
  entity_table: string;
  entity_id: string;
  operation: 'UPSERT' | 'DELETE';
  payload_json: string;
  created_at: string;
  synced: number; // 0 = pending, 1 = synced
}
