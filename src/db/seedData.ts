import { db } from './database';
import { DEFAULT_AGE_GROUPS } from '../constants/handballLabels';
import type {
  AgeGroup,
  Club,
  ClubMember,
  Exercise,
  MultiWeekPlan,
  PlanWeek,
  SessionBlock,
  SessionNote,
  SessionPhase,
  SessionTemplate,
  Team,
  TeamMember,
  TrainingSession
} from '../types/domain';

const SEEDED_AGE_GROUPS_BY_ID: Record<string, AgeGroup[]> = {
  'ex-warmup-parteiball': ['E_YOUTH', 'D_YOUTH', 'C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS'],
  'ex-tw-einwerfen': ['D_YOUTH', 'C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS'],
  'ex-stossen-grund': ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS'],
  'ex-stossen-variante': ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS'],
  'ex-abwehr-321': ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
};

async function ensureExerciseAgeGroups(): Promise<void> {
  const allExercises = await db.exercises.toArray();
  const updates = allExercises
    .filter((ex) => !Array.isArray(ex.categories?.age_groups) || ex.categories.age_groups.length === 0)
    .map((ex) => ({
      ...ex,
      categories: {
        ...ex.categories,
        age_groups: SEEDED_AGE_GROUPS_BY_ID[ex.id] ?? DEFAULT_AGE_GROUPS
      }
    }));

  if (updates.length > 0) {
    await db.exercises.bulkPut(updates);
  }
}

export async function seedInitialDataIfEmpty(): Promise<void> {
  const existingClubsCount = await db.clubs.count();
  if (existingClubsCount > 0) {
    await ensureExerciseAgeGroups();
    return;
  }

  const now = new Date().toISOString();

  const club: Club = {
    id: 'club-sgh-1',
    name: 'SG Handball Musterstadt',
    invite_code: 'SGH-2026',
    created_at: now,
    updated_at: now
  };

  const members: ClubMember[] = [
    {
      id: 'member-1',
      club_id: club.id,
      club_role: 'CLUB_ADMIN',
      display_name: 'Markus Weber (Haupttrainer / Jugendkoordinator)',
      email: 'markus.weber@sg-musterstadt.de',
      created_at: now,
      updated_at: now
    },
    {
      id: 'member-2',
      club_id: club.id,
      club_role: 'COACH',
      display_name: 'Lukas Hartmann (Co- & Torwarttrainer)',
      email: 'lukas.hartmann@sg-musterstadt.de',
      created_at: now,
      updated_at: now
    },
    {
      id: 'member-3',
      club_id: club.id,
      club_role: 'COACH',
      display_name: 'Stefan Köhler (Trainer 1. Herren)',
      email: 'stefan.koehler@sg-musterstadt.de',
      created_at: now,
      updated_at: now
    }
  ];

  const teams: Team[] = [
    {
      id: 'team-mb',
      club_id: club.id,
      name: 'männliche B-Jugend',
      age_group: 'B_YOUTH',
      season: '2026/27',
      default_schedule: [
        {
          id: 'sched-mb-tue',
          weekday: 2,
          weekdayLabel: 'Dienstag',
          startTime: '18:30',
          endTime: '20:00',
          hallName: 'Sporthalle Nord'
        },
        {
          id: 'sched-mb-thu',
          weekday: 4,
          weekdayLabel: 'Donnerstag',
          startTime: '18:30',
          endTime: '20:00',
          hallName: 'Sporthalle Nord'
        }
      ],
      is_archived: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'team-m1',
      club_id: club.id,
      name: '1. Herren',
      age_group: 'ADULTS',
      season: '2026/27',
      default_schedule: [
        {
          id: 'sched-m1-tue',
          weekday: 2,
          weekdayLabel: 'Dienstag',
          startTime: '20:00',
          endTime: '21:30',
          hallName: 'Sporthalle Nord'
        },
        {
          id: 'sched-m1-thu',
          weekday: 4,
          weekdayLabel: 'Donnerstag',
          startTime: '20:00',
          endTime: '21:30',
          hallName: 'Sporthalle Nord'
        }
      ],
      is_archived: false,
      created_at: now,
      updated_at: now
    }
  ];

  const teamMembers: TeamMember[] = [
    {
      id: 'tm-1',
      team_id: 'team-mb',
      club_member_id: 'member-1',
      team_role: 'HEAD_COACH'
    },
    {
      id: 'tm-2',
      team_id: 'team-mb',
      club_member_id: 'member-2',
      team_role: 'ASSISTANT_COACH'
    },
    {
      id: 'tm-3',
      team_id: 'team-m1',
      club_member_id: 'member-3',
      team_role: 'HEAD_COACH'
    }
  ];

  const exercises: Exercise[] = [
    {
      id: 'ex-warmup-parteiball',
      club_id: club.id,
      created_by_member_id: 'member-1',
      visibility: 'CLUB',
      title: 'Parteiball 5gg5 auf Hütchentore mit Prellverbot',
      default_duration_min: 15,
      min_players: 8,
      max_players: 16,
      goalkeepers: 0,
      categories: {
        phases: ['WARMUP', 'SMALL_GAME'],
        focus: ['PASSING_CATCHING', 'OFFENSE_GROUP'],
        level: 'BASIC',
        age_groups: ['E_YOUTH', 'D_YOUTH', 'C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
      },
      materials: [
        { type: 'BALL', quantity: 2 },
        { type: 'CONE', quantity: 8 },
        { type: 'BIBS', quantity: 2 }
      ],
      setup_description:
        'Halbfeld zwischen 6m und Mittellinie. 4 farbige Hütchentore (je 2m breit) in den Ecken aufstellen. Zwei Teams à 5-7 Spieler einteilen.',
      flow_description:
        '1. Gespielt wird 5gg5 ohne Prellen (max. 3 Schritte, max. 3 Sekunden Ballhaltezeit).\n2. Punktgewinn durch Bodenpass durch eines der 4 Hütchentore zu einem einlaufenden Mitspieler.\n3. Nach Punktgewinn bleibt das Team in Ballbesitz, muss aber sofort auf ein anderes Hütchentor angreifen.',
      coaching_points:
        '- Freilaufen in den offenen Raum nach dem Abspiel (Give & Go)\n- Kopf oben halten und frühe Vororientierung vor der Ballannahme\n- Aktive Fußarbeit in der Balleroberung',
      variations_text:
        'Steigerung: Nach jedem Pass muss der Passgeber ein Außenhütchen umlaufen (permanente Über-/Unterzahl-Situation).',
      external_links: [],
      tactic_board_data: {
        version: 1,
        courtTemplate: 'HALF_COURT_VERTICAL',
        nodes: [
          { id: 'c1', type: 'EQUIPMENT_CONE', x: 0.15, y: 0.35, color: '#facc15' },
          { id: 'c2', type: 'EQUIPMENT_CONE', x: 0.85, y: 0.35, color: '#facc15' },
          { id: 'c3', type: 'EQUIPMENT_CONE', x: 0.15, y: 0.82, color: '#facc15' },
          { id: 'c4', type: 'EQUIPMENT_CONE', x: 0.85, y: 0.82, color: '#facc15' },
          { id: 'p1', type: 'OFFENSE_PLAYER', label: 'A1', x: 0.32, y: 0.58, color: '#2563eb', hasBall: true },
          { id: 'p2', type: 'OFFENSE_PLAYER', label: 'A2', x: 0.62, y: 0.45, color: '#2563eb' },
          { id: 'd1', type: 'DEFENSE_PLAYER', label: 'B1', x: 0.45, y: 0.50, color: '#dc2626' }
        ],
        paths: [
          {
            id: 'path-w1',
            type: 'RUN_PATH',
            stepNumber: 1,
            fromNodeId: 'p2',
            points: [
              { x: 0.62, y: 0.45 },
              { x: 0.80, y: 0.36 }
            ],
            color: '#f8fafc'
          },
          {
            id: 'path-w2',
            type: 'PASS_PATH',
            stepNumber: 2,
            fromNodeId: 'p1',
            points: [
              { x: 0.32, y: 0.58 },
              { x: 0.78, y: 0.37 }
            ],
            color: '#60a5fa'
          }
        ]
      },
      is_deleted: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'ex-tw-einwerfen',
      club_id: club.id,
      created_by_member_id: 'member-2',
      visibility: 'CLUB',
      title: 'Torwart-Einwerfen: 4-Sektoren-Serie mit Außen-Folgewurf',
      default_duration_min: 15,
      min_players: 4,
      max_players: 10,
      goalkeepers: 2,
      categories: {
        phases: ['GOALKEEPER_WARMUP'],
        focus: ['GOALKEEPER_TECHNIQUE', 'SHOOTING'],
        level: 'BASIC',
        age_groups: ['D_YOUTH', 'C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
      },
      materials: [
        { type: 'BALL_CART', quantity: 1 },
        { type: 'BALL', quantity: 12 },
        { type: 'CONE', quantity: 2 }
      ],
      setup_description:
        'Anstellreihe im Rückraum Mitte (RM) mit Ballwagen sowie auf Linksaußen (LA) und Rechtsaußen (RA). 2 Torhüter wechseln alle 6 Würfe.',
      flow_description:
        '1. Durchgang: Würfe aus 9m halbhoch auf die Handseite (Ankündigen: erst links, dann rechts).\n2. Durchgang: Aufsetzer in die langen Ecken.\n3. Durchgang: RM wirft gezielt auf die kurze Ecke -> direkt danach springt LA/RA zum Folgewurf ein (TW-Umschaltbewegung!).',
      coaching_points:
        '- Disziplin bei den Schützen: Keine freien Gewaltwürfe beim Einwerfen!\n- Torwart: Kurze Grundstellung auf dem Fußballen, nach Parade sofortige Grundstellungs-Korrektur zum Außenwinkel.',
      variations_text: 'Optional mit langem Gegenstoß-Abwurf des Torwarts auf den startenden Außenspieler.',
      external_links: [],
      tactic_board_data: {
        version: 1,
        courtTemplate: 'HALF_COURT_VERTICAL',
        nodes: [
          { id: 'tw1', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
          { id: 'rm-q', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.50, y: 0.45, color: '#2563eb', hasBall: true, isQueue: true, queueCount: 5 },
          { id: 'la-q', type: 'OFFENSE_PLAYER', label: 'LA', x: 0.12, y: 0.18, color: '#2563eb', hasBall: true, isQueue: true, queueCount: 2 },
          { id: 'ra-q', type: 'OFFENSE_PLAYER', label: 'RA', x: 0.88, y: 0.18, color: '#2563eb', hasBall: true, isQueue: true, queueCount: 2 }
        ],
        paths: [
          {
            id: 'shot-1',
            type: 'SHOT_PATH',
            stepNumber: 1,
            fromNodeId: 'rm-q',
            points: [
              { x: 0.50, y: 0.45 },
              { x: 0.53, y: 0.10 }
            ],
            color: '#f59e0b'
          },
          {
            id: 'shot-2',
            type: 'SHOT_PATH',
            stepNumber: 2,
            fromNodeId: 'la-q',
            points: [
              { x: 0.12, y: 0.18 },
              { x: 0.46, y: 0.09 }
            ],
            color: '#f59e0b'
          }
        ]
      },
      is_deleted: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'ex-stossen-grund',
      club_id: club.id,
      created_by_member_id: 'member-1',
      visibility: 'CLUB',
      title: 'Stoßen-Zurückstoßen RL-RM-RR mit Kreis-Kooperation (Grundübung)',
      default_duration_min: 20,
      min_players: 7,
      max_players: 14,
      goalkeepers: 1,
      categories: {
        phases: ['GROUND_EXERCISE'],
        focus: ['OFFENSE_GROUP', 'PASSING_CATCHING'],
        level: 'ADVANCED',
        age_groups: ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
      },
      materials: [
        { type: 'BALL', quantity: 6 },
        { type: 'CONE', quantity: 4 },
        { type: 'COORDINATION_LADDER', quantity: 1 }
      ],
      setup_description:
        'Rückraum-Positionen RL, RM und RR besetzen (Anstellreihen auf RL und RR mit Bällen). Am 6m-Kreis arbeitet 1 Kreisläufer (KM) gegen 2 Innenblock-Abwehrspieler (IR, IL). Vor RL liegt eine Koordinationsleiter für den Auftaktschritt.',
      flow_description:
        '1. RL durchläuft die Koordinationsleiter und stößt explosiv auf die Nahtstelle zwischen HR und IL.\n2. Parallelpass im Lauf auf den dynamisch anlaufenden RM.\n3. RM bindet IR und entscheidet: Steckpass an KM (falls IR heraustritt) oder Weiterpassen auf den einlaufenden RR zum Torwurf.',
      coaching_points:
        '- Ballannahme immer in der Vorwärtsbewegung (Nullschritt oder dynamischer Dreischritt-Rhythmus)\n- Tiefgang bis auf 8,5m, um die Abwehr echt zu binden\n- Rückwärtsbewegung sofort nach dem Abspiel einleiten',
      variations_text:
        'Siehe verknüpfte Variante: Übergang in Sperre-Absetzen am Kreis nach Pass von RL auf RM.',
      source_url: 'https://www.dhb.de/de/training/rahmentrainingskonzeption',
      external_links: [
        {
          title: 'DHB Rahmentrainingskonzeption – Kooperation Rückraum/Kreis',
          url: 'https://www.dhb.de',
          platform: 'DHB'
        }
      ],
      tactic_board_data: {
        version: 1,
        courtTemplate: 'HALF_COURT_VERTICAL',
        presetUsed: 'DEFENSE_6_0_VS_3_3',
        nodes: [
          { id: 'tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
          { id: 'node-rl', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.22, y: 0.48, color: '#2563eb', hasBall: true, isQueue: true, queueCount: 3 },
          { id: 'node-rm', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.50, y: 0.50, color: '#2563eb' },
          { id: 'node-rr', type: 'OFFENSE_PLAYER', label: 'RR', x: 0.78, y: 0.48, color: '#2563eb', isQueue: true, queueCount: 3 },
          { id: 'node-km', type: 'OFFENSE_PLAYER', label: 'KM', x: 0.44, y: 0.25, color: '#2563eb' },
          { id: 'node-il', type: 'DEFENSE_PLAYER', label: 'IL', x: 0.38, y: 0.25, color: '#dc2626' },
          { id: 'node-ir', type: 'DEFENSE_PLAYER', label: 'IR', x: 0.58, y: 0.25, color: '#dc2626' },
          { id: 'wp-1', type: 'WAYPOINT', x: 0.30, y: 0.36 }
        ],
        paths: [
          {
            id: 'p1',
            type: 'RUN_PATH',
            stepNumber: 1,
            fromNodeId: 'node-rl',
            toWaypointId: 'wp-1',
            points: [
              { x: 0.22, y: 0.48 },
              { x: 0.30, y: 0.36 }
            ],
            color: '#f8fafc'
          },
          {
            id: 'p2',
            type: 'PASS_PATH',
            stepNumber: 2,
            fromWaypointId: 'wp-1',
            toNodeId: 'node-rm',
            points: [
              { x: 0.30, y: 0.36 },
              { x: 0.50, y: 0.38 }
            ],
            color: '#60a5fa'
          },
          {
            id: 'p3',
            type: 'PASS_PATH',
            stepNumber: 3,
            fromNodeId: 'node-rm',
            toNodeId: 'node-km',
            points: [
              { x: 0.50, y: 0.38 },
              { x: 0.44, y: 0.22 }
            ],
            color: '#60a5fa'
          }
        ]
      },
      is_deleted: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'ex-stossen-variante',
      club_id: club.id,
      created_by_member_id: 'member-1',
      parent_exercise_id: 'ex-stossen-grund',
      visibility: 'CLUB',
      title: 'Variante: Stoßen RL-RM mit Sperre-Absetzen am Kreis (2gg2)',
      default_duration_min: 20,
      min_players: 6,
      max_players: 12,
      goalkeepers: 1,
      categories: {
        phases: ['GROUND_GAME'],
        focus: ['OFFENSE_GROUP', 'DEFENSE_6_0'],
        level: 'ADVANCED',
        age_groups: ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
      },
      materials: [
        { type: 'BALL', quantity: 6 },
        { type: 'CONE', quantity: 2 }
      ],
      setup_description:
        'Wie Grundübung, jedoch stellt KM nach dem Auftaktstoß von RL eine Außensperre am Abwehrspieler IL für den durchstoßenden RM.',
      flow_description:
        '1. RL stößt an und passt zu RM.\n2. KM setzt die Sperre an der Außenschulter von IL.\n3. RM nutzt die Sperre zum Durchbruch oder spielt den Ball in die Absetzbewegung von KM.',
      coaching_points:
        '- KM: Breite, stabile Fußstellung bei der Sperre, Hände am Körper lassen (kein Stürmerfoul!)\n- RM: Eng an der Schulter des Kreisläufers vorbeiziehen',
      variations_text: 'Wenn HR von außen verdichtet, Weiterspielen auf den eingelaufenen LA.',
      external_links: [],
      tactic_board_data: {
        version: 1,
        courtTemplate: 'HALF_COURT_VERTICAL',
        nodes: [
          { id: 'tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
          { id: 'node-rl', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.22, y: 0.45, color: '#2563eb', hasBall: true, isQueue: true, queueCount: 3 },
          { id: 'node-rm', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.52, y: 0.46, color: '#2563eb' },
          { id: 'node-km', type: 'OFFENSE_PLAYER', label: 'KM', x: 0.34, y: 0.24, color: '#2563eb' },
          { id: 'node-il', type: 'DEFENSE_PLAYER', label: 'IL', x: 0.40, y: 0.25, color: '#dc2626' }
        ],
        paths: [
          {
            id: 'sp-1',
            type: 'SCREEN_BLOCK_PATH',
            stepNumber: 1,
            fromNodeId: 'node-km',
            points: [
              { x: 0.34, y: 0.24 },
              { x: 0.38, y: 0.25 }
            ],
            color: '#f59e0b'
          },
          {
            id: 'sp-2',
            type: 'DRIBBLE_PATH',
            stepNumber: 2,
            fromNodeId: 'node-rm',
            points: [
              { x: 0.52, y: 0.46 },
              { x: 0.33, y: 0.28 }
            ],
            color: '#f8fafc'
          }
        ]
      },
      is_deleted: false,
      created_at: now,
      updated_at: now
    },
    {
      id: 'ex-abwehr-321',
      club_id: club.id,
      created_by_member_id: 'member-1',
      visibility: 'TEAM',
      owner_team_id: 'team-mb',
      title: '3:2:1-Abwehr: Übergeben/Übernehmen zwischen VM und Halbverteidiger',
      default_duration_min: 25,
      min_players: 8,
      max_players: 14,
      goalkeepers: 1,
      categories: {
        phases: ['GROUND_GAME', 'TARGET_GAME'],
        focus: ['DEFENSE_3_2_1', 'DEFENSE_GROUP'],
        level: 'PERFORMANCE',
        age_groups: ['C_YOUTH', 'B_YOUTH', 'A_YOUTH', 'ADULTS']
      },
      materials: [
        { type: 'BALL', quantity: 4 },
        { type: 'BIBS', quantity: 1 },
        { type: 'CONE', quantity: 4 }
      ],
      setup_description:
        '3:2:1-Abwehrformation im Halbfeld (Fokus auf VM, HL, HR und HM) gegen Rückraum RL, RM, RR + KM.',
      flow_description:
        '1. Angriff startet mit Kreuzbewegung auf RM/RL.\n2. VM begleitet den kreuzenden Spieler bis zur Übergabezone und kommuniziert laut („Nimm!" / „Bleib!").\n3. HL tritt offensiv auf 9,5m heraus, während HM am Kreis absichert.',
      coaching_points:
        '- Lautstarke verbale Kommunikation vor dem Kreuzungspunkt\n- Kein Hinterherlaufen hinter dem Rücken von VM, sondern gestaffelte Tiefe halten',
      variations_text: 'Bei Ballgewinn sofortiger Gegenstoß (1. Welle) auf das gegenüberliegende Tor.',
      external_links: [],
      tactic_board_data: {
        version: 1,
        courtTemplate: 'HALF_COURT_VERTICAL',
        presetUsed: 'DEFENSE_3_2_1',
        nodes: [
          { id: 'tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
          { id: 'd-hm', type: 'DEFENSE_PLAYER', label: 'HM', x: 0.50, y: 0.25, color: '#dc2626' },
          { id: 'd-hl', type: 'DEFENSE_PLAYER', label: 'HL', x: 0.28, y: 0.30, color: '#dc2626' },
          { id: 'd-hr', type: 'DEFENSE_PLAYER', label: 'HR', x: 0.72, y: 0.30, color: '#dc2626' },
          { id: 'd-vm', type: 'DEFENSE_PLAYER', label: 'VM', x: 0.50, y: 0.39, color: '#dc2626' },
          { id: 'a-rl', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.24, y: 0.48, color: '#2563eb' },
          { id: 'a-rm', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.50, y: 0.52, color: '#2563eb', hasBall: true },
          { id: 'a-rr', type: 'OFFENSE_PLAYER', label: 'RR', x: 0.76, y: 0.48, color: '#2563eb' }
        ],
        paths: [
          {
            id: 'def-move-1',
            type: 'RUN_PATH',
            stepNumber: 1,
            fromNodeId: 'd-hl',
            points: [
              { x: 0.28, y: 0.30 },
              { x: 0.25, y: 0.42 }
            ],
            color: '#ef4444'
          }
        ]
      },
      is_deleted: false,
      created_at: now,
      updated_at: now
    }
  ];

  const templates: SessionTemplate[] = [
    {
      id: 'tpl-standard-90',
      club_id: club.id,
      title: 'Standard-Hallentraining 90 Min (mit parallelem TW-Block)',
      description: 'Bewährte 5-Phasen-Struktur für 90 Minuten Hallenzeit inkl. Gruppenteilung Feld/Torwart.',
      default_duration_min: 90,
      phases_template: [
        { name: '1. Aufwärmen & Kleines Spiel', target_duration_min: 15, default_exercise_id: 'ex-warmup-parteiball' },
        { name: '2. Torwart-Einwerfen & Individuelle Auftakttechnik (Parallel)', target_duration_min: 15, default_exercise_id: 'ex-tw-einwerfen' },
        { name: '3. Hauptteil 1: Kleingruppe / Kooperation', target_duration_min: 25, default_exercise_id: 'ex-stossen-grund' },
        { name: '4. Hauptteil 2: Mannschaftstaktik / Zielspiel', target_duration_min: 25, default_exercise_id: 'ex-abwehr-321' },
        { name: '5. Abschlussspiel & Cool-Down', target_duration_min: 10 }
      ],
      updated_at: now
    }
  ];

  const multiWeekPlan: MultiWeekPlan = {
    id: 'mwp-mb-hinrunde',
    team_id: 'team-mb',
    title: 'Mesozyklus November/Dezember: Kooperation Rückraum/Kreis & 3:2:1-Abwehr',
    start_date: '2026-11-09',
    end_date: '2026-12-06',
    goals: 'Sichere Entscheidungsfindung im 2gg2/3gg3 gegen defensive 6:0 sowie aktives Übergeben in unserer 3:2:1-Formation.',
    updated_at: now
  };

  const planWeeks: PlanWeek[] = [
    {
      id: 'pw-1',
      multi_week_plan_id: multiWeekPlan.id,
      week_number: 1,
      start_date: '2026-11-09',
      focus_theme: 'Woche 1: Individuelle Stoßbewegung & Passqualität unter Druck',
      focus_tags: ['PASSING_CATCHING', 'OFFENSE_INDIVIDUAL'],
      color_hex: '#3b82f6',
      notes: 'Auftaktwoche nach Herbstpause – Fokus auf saubere Grundtechnik.',
      updated_at: now
    },
    {
      id: 'pw-2',
      multi_week_plan_id: multiWeekPlan.id,
      week_number: 2,
      start_date: '2026-11-16',
      focus_theme: 'Woche 2: Kooperation RL-RM-KM & 3:2:1-Abwehr Nahtstellen',
      focus_tags: ['OFFENSE_GROUP', 'DEFENSE_3_2_1', 'GOALKEEPER_TECHNIQUE'],
      color_hex: '#10b981',
      notes: 'Aktuelle Trainingswoche vor dem Topspiel am Samstag.',
      updated_at: now
    },
    {
      id: 'pw-3',
      multi_week_plan_id: multiWeekPlan.id,
      week_number: 3,
      start_date: '2026-11-23',
      focus_theme: 'Woche 3: Sperre-Absetzen am Kreis & Umschaltspiel 1./2. Welle',
      focus_tags: ['OFFENSE_GROUP', 'FAST_BREAK_1ST_WAVE', 'FAST_BREAK_2ND_WAVE'],
      color_hex: '#f59e0b',
      notes: 'Hohe Intensität im Tempospiel.',
      updated_at: now
    },
    {
      id: 'pw-4',
      multi_week_plan_id: multiWeekPlan.id,
      week_number: 4,
      start_date: '2026-11-30',
      focus_theme: 'Woche 4: Wettkampf-Integration 6gg6 & Überzahl/Unterzahl',
      focus_tags: ['OFFENSE_TEAM', 'DEFENSE_6_0', 'DEFENSE_3_2_1'],
      color_hex: '#8b5cf6',
      notes: 'Belastungssteuerung vor dem Auswärtsspiel.',
      updated_at: now
    }
  ];

  const trainingSession: TrainingSession = {
    id: 'session-tue-1',
    team_id: 'team-mb',
    plan_week_id: 'pw-2',
    session_date: '2026-11-17',
    start_time: '18:30',
    end_time: '20:00',
    planned_duration_min: 90,
    title: 'Dienstagstraining: Kooperation RL/RM/KM + 3:2:1-Abwehr',
    custom_materials_override: [],
    status: 'READY',
    updated_at: now
  };

  const sessionPhases: SessionPhase[] = [
    {
      id: 'phase-1',
      training_session_id: trainingSession.id,
      name: '1. Aufwärmen & Einstimmung',
      sort_order: 1,
      target_duration_min: 15,
      updated_at: now
    },
    {
      id: 'phase-2',
      training_session_id: trainingSession.id,
      name: '2. Torwart-Einwerfen & Athletik/Auftakt (Parallelbetrieb)',
      sort_order: 2,
      target_duration_min: 15,
      updated_at: now
    },
    {
      id: 'phase-3',
      training_session_id: trainingSession.id,
      name: '3. Hauptteil 1: Kleingruppe Angriff (RL-RM-KM)',
      sort_order: 3,
      target_duration_min: 20,
      updated_at: now
    },
    {
      id: 'phase-4',
      training_session_id: trainingSession.id,
      name: '4. Hauptteil 2: 3:2:1-Abwehr Kooperation',
      sort_order: 4,
      target_duration_min: 25,
      updated_at: now
    },
    {
      id: 'phase-5',
      training_session_id: trainingSession.id,
      name: '5. Abschlussspiel 6gg6 & Cool-Down',
      sort_order: 5,
      target_duration_min: 15,
      updated_at: now
    }
  ];

  const sessionBlocks: SessionBlock[] = [
    {
      id: 'block-1',
      session_phase_id: 'phase-1',
      exercise_id: 'ex-warmup-parteiball',
      time_slot_index: 0,
      track_label: 'Alle Spieler',
      assigned_member_id: 'member-1',
      custom_duration_min: 15,
      updated_at: now
    },
    // Parallel tracks in Phase 2 (both have time_slot_index: 0!)
    {
      id: 'block-2a',
      session_phase_id: 'phase-2',
      exercise_id: 'ex-tw-einwerfen',
      time_slot_index: 0,
      track_label: 'Spur A: Torhüter + Außenspieler',
      assigned_member_id: 'member-2',
      custom_duration_min: 15,
      updated_at: now
    },
    {
      id: 'block-2b',
      session_phase_id: 'phase-2',
      quick_block_title: 'Koordinationsleiter & Pass-Kontinuum im Rückraum',
      quick_block_description:
        'Rückraum- und Kreisspieler arbeiten auf der anderen Hallenhälfte an Fußarbeit (Nullschritt/Dreischritt) und scharfen Parallelpässen.',
      time_slot_index: 0,
      track_label: 'Spur B: Rückraum + Kreis',
      assigned_member_id: 'member-1',
      custom_duration_min: 15,
      updated_at: now
    },
    {
      id: 'block-3',
      session_phase_id: 'phase-3',
      exercise_id: 'ex-stossen-grund',
      time_slot_index: 0,
      track_label: 'Alle Spieler',
      assigned_member_id: 'member-1',
      custom_duration_min: 20,
      updated_at: now
    },
    {
      id: 'block-4',
      session_phase_id: 'phase-4',
      exercise_id: 'ex-abwehr-321',
      time_slot_index: 0,
      track_label: 'Alle Spieler',
      assigned_member_id: 'member-1',
      custom_duration_min: 25,
      updated_at: now
    },
    {
      id: 'block-5',
      session_phase_id: 'phase-5',
      quick_block_title: '6gg6 Wettkampfspiel mit Zusatzpunkt für Kreis-Anspiel + Auslaufen',
      quick_block_description: 'Tore über Kreisläufer oder aus Gegenstoß 1. Welle zählen doppelt.',
      time_slot_index: 0,
      track_label: 'Alle Spieler',
      assigned_member_id: 'member-1',
      custom_duration_min: 15,
      updated_at: now
    }
  ];

  const sessionNotes: SessionNote[] = [
    {
      id: 'note-1',
      training_session_id: trainingSession.id,
      session_block_id: 'block-3',
      author_member_id: 'member-1',
      author_name: 'Markus Weber',
      content: 'Heute besonders auf den Abstand von RL zur 9m-Linie beim Auftakt achten (zuletzt zu dicht aufgelaufen).',
      created_at: now,
      updated_at: now
    },
    {
      id: 'note-2',
      training_session_id: trainingSession.id,
      session_block_id: 'block-2a',
      author_member_id: 'member-2',
      author_name: 'Lukas Hartmann',
      content: 'Mit beiden Torhütern im 3. Durchgang explizit die kurze Ecke gegen LA absprechen.',
      created_at: now,
      updated_at: now
    }
  ];

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
      await db.clubs.put(club);
      await db.clubMembers.bulkPut(members);
      await db.teams.bulkPut(teams);
      await db.teamMembers.bulkPut(teamMembers);
      await db.exercises.bulkPut(exercises);
      await db.sessionTemplates.bulkPut(templates);
      await db.multiWeekPlans.put(multiWeekPlan);
      await db.planWeeks.bulkPut(planWeeks);
      await db.trainingSessions.put(trainingSession);
      await db.sessionPhases.bulkPut(sessionPhases);
      await db.sessionBlocks.bulkPut(sessionBlocks);
      await db.sessionNotes.bulkPut(sessionNotes);
    }
  );
}
