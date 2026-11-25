import type {
  AgeGroup,
  ComplexityLevel,
  Exercise,
  HandballFocusTag,
  MaterialItem,
  MaterialType,
  TacticBoardAnimationSettings,
  TacticBoardData,
  TacticKeyframe,
  TacticKeyframeNodeState,
  TacticNode,
  TacticPath,
  TacticZone,
  TrainingPhaseCategory,
  VisibilityLevel
} from '../types/domain';
import {
  ALL_AGE_GROUPS,
  ATHLETICS_RECOVERY_FOCUS_TAGS,
  DEFAULT_AGE_GROUPS,
  TACTIC_FOCUS_TAGS,
  TECHNIQUE_FOCUS_TAGS
} from '../constants/handballLabels';
import { generateKeyframesFromPaths } from './tacticBoardUtils';
import { sanitizeHttpUrl } from './securityUtils';

export const AI_EXERCISE_SYSTEM_PROMPT = `Du bist ein erfahrener DHB-Handball-Trainer und Daten-Assistent.
Deine Aufgabe ist es, die vom Nutzer bereitgestellten Handball-Übungen (aus Screenshots, Skizzen-Bildern, PDF-Auszügen oder Web-Texten) in das exakte JSON-Format unserer Handball Trainings-App umzuwandeln.

Antworte AUSSCHLIESSLICH mit validem JSON (entweder ein einzelnes Objekt oder ein Array [...] bei mehreren Übungen).

### Koordinatensystem für das Taktikboard (tactic_board_data):
- Alle Koordinaten (x, y) sind normiert zwischen 0.04 und 0.96. Erlaubte Templates: "HALF_COURT_VERTICAL" (Standard), "FULL_COURT", "GOAL_SECTOR_ZOOM", "FREE_SPACE".
- Bei HALF_COURT_VERTICAL (Halbfeld vertikal):
  - Das Handballtor befindet sich OBEN MITTIG bei (x: 0.50, y: 0.05), der Torwart (TW) bei (x: 0.50, y: 0.09).
  - Die 6m-Torraumlinie verläuft bogenförmig bis Scheitelpunkt (x: 0.50, y: 0.243; x-Spanne 0.26..0.74); die 7m-Markierung liegt bei y: 0.286; die 9m-Freiwurflinie bis (x: 0.50, y: 0.386; x-Spanne 0.13..0.87).
  - Typische Angriffs-Grundpositionen: LA: (0.10, 0.16), RL: (0.24, 0.48), RM: (0.50, 0.54), RR: (0.76, 0.48), RA: (0.90, 0.16), KM: (0.45, 0.25).
  - Typische Abwehr-Positionen (6:0): AL: (0.16, 0.16), HL: (0.29, 0.23), IL: (0.43, 0.26), IR: (0.57, 0.26), HR: (0.71, 0.23), AR: (0.84, 0.16), VM (bei 5:1/3:2:1): (0.50, 0.39).
- Bei FULL_COURT (Ganzfeld, immer HORIZONTAL von links nach rechts):
  - Linkes Tor bei (0.04, 0.50), TW1 bei (0.08, 0.50), linker 6m-Scheitel bei x: 0.17, Mittellinie bei x: 0.50, rechter 6m-Scheitel bei x: 0.83, TW2 bei (0.92, 0.50), rechtes Tor bei (0.96, 0.50).
- Bei GOAL_SECTOR_ZOOM (Torraum-Zoom): Tor oben (0.50, 0.05), TW (0.50, 0.14..0.20), 6m-Scheitel y: 0.414, 7m y: 0.486, 9m-Scheitel y: 0.636.
- Bei FREE_SPACE (Freifläche ohne Tore): für Koordinationsleitern, Staffeln, Wandwürfe, Partnerübungen und Cool-Down.
- Wenn auf einer Position im Training eine Warteschlange/Anstellreihe steht, setze "isQueue": true und "queueCount": 3.
- Optional (v2): "zones" für Ziel-/Sperrzonen ({ id, shape: "RECT"|"ELLIPSE", x, y, width, height, color, opacity, label }), "controlPoint": { "x": 0.35, "y": 0.42 } auf Pfaden für Bogenläufe, sowie "keyframes" für explizite Animations-Szenen.

### Erlaubte Enum-Werte:
- phases: ["WARMUP", "SMALL_GAME", "GOALKEEPER_WARMUP", "GROUND_EXERCISE", "GROUND_GAME", "TARGET_GAME", "ATHLETICS_COORDINATION", "COOL_DOWN"]
- focus: ["OFFENSE_INDIVIDUAL", "OFFENSE_GROUP", "OFFENSE_TEAM", "DEFENSE_INDIVIDUAL", "DEFENSE_GROUP", "DEFENSE_6_0", "DEFENSE_5_1", "DEFENSE_3_2_1", "FAST_BREAK_1ST_WAVE", "FAST_BREAK_2ND_WAVE", "RETREAT", "SHOOTING", "PASSING_CATCHING", "GOALKEEPER_TECHNIQUE", "DRIBBLING", "PASSING", "CATCHING", "JUMP_SHOT", "STANDING_THROW", "HIP_UNDERARM_SHOT", "FALLING_SHOT", "LOB_SPIN_SHOT", "FEINT_1V1", "CROSSING_SCREEN", "FOOTWORK_DEFENSE", "ATHLETICS_CONDITIONING", "REGENERATION_MOBILITY"]
- level: "BASIC" | "ADVANCED" | "PERFORMANCE"
- age_groups (Altersstufen, mindestens 1 Wert): ["MINIS", "F_YOUTH", "E_YOUTH", "D_YOUTH", "C_YOUTH", "B_YOUTH", "A_YOUTH", "ADULTS"]
- materials.type: "BALL" | "BALL_CART" | "CONE" | "BIBS" | "COORDINATION_LADDER" | "SOFT_MAT" | "POLE_AIRBODY" | "VAULTING_BOX" | "TARGET_CORNER" | "MINI_GOAL"
- nodes.type: "OFFENSE_PLAYER" | "DEFENSE_PLAYER" | "GOALKEEPER" | "COACH_FEEDER" | "EQUIPMENT_CONE" | "EQUIPMENT_MAT" | "EQUIPMENT_GOAL_TARGET" | "WAYPOINT"
- paths.type: "RUN_PATH" | "PASS_PATH" | "DRIBBLE_PATH" | "SHOT_PATH" | "SCREEN_BLOCK_PATH" | "FEINT_PATH"

### Beispiel-JSON-Struktur:
[
  {
    "title": "Name der Übung",
    "default_duration_min": 15,
    "min_players": 6,
    "max_players": 12,
    "goalkeepers": 1,
    "source_url": "Optionaler Link zur Quelle",
    "categories": {
      "phases": ["GROUND_EXERCISE"],
      "focus": ["OFFENSE_GROUP", "PASSING_CATCHING"],
      "level": "ADVANCED",
      "age_groups": ["C_YOUTH", "B_YOUTH", "A_YOUTH", "ADULTS"]
    },
    "materials": [
      { "type": "BALL", "quantity": 6 },
      { "type": "CONE", "quantity": 4 }
    ],
    "setup_description": "Aufbau und Organisation...",
    "flow_description": "1. Schritt 1\\n2. Schritt 2...",
    "coaching_points": "- Wichtiger Coaching-Punkt 1\\n- Punkt 2",
    "variations_text": "Variationen und Steigerungen...",
    "tactic_board_data": {
      "version": 1,
      "courtTemplate": "HALF_COURT_VERTICAL",
      "nodes": [
        { "id": "tw", "type": "GOALKEEPER", "label": "TW", "x": 0.5, "y": 0.08, "color": "#10b981" },
        { "id": "rl", "type": "OFFENSE_PLAYER", "label": "RL", "x": 0.24, "y": 0.48, "hasBall": true, "isQueue": true, "queueCount": 3 },
        { "id": "rm", "type": "OFFENSE_PLAYER", "label": "RM", "x": 0.50, "y": 0.50 },
        { "id": "wp1", "type": "WAYPOINT", "x": 0.30, "y": 0.36 }
      ],
      "paths": [
        {
          "id": "p1",
          "type": "RUN_PATH",
          "stepNumber": 1,
          "fromNodeId": "rl",
          "toWaypointId": "wp1",
          "points": [{ "x": 0.24, "y": 0.48 }, { "x": 0.30, "y": 0.36 }]
        },
        {
          "id": "p2",
          "type": "PASS_PATH",
          "stepNumber": 2,
          "fromWaypointId": "wp1",
          "toNodeId": "rm",
          "points": [{ "x": 0.30, "y": 0.36 }, { "x": 0.50, "y": 0.40 }]
        }
      ]
    }
  }
]`;

function clampCoord(val: unknown, fallback = 0.5): number {
  const num = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(num)) return fallback;
  return Math.min(0.96, Math.max(0.04, num));
}

function normalizeTacticBoard(rawBoard: unknown): TacticBoardData | undefined {
  if (!rawBoard || typeof rawBoard !== 'object') return undefined;
  const obj = rawBoard as Record<string, unknown>;

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const nodes: TacticNode[] = rawNodes.map((n, idx) => {
    const item = (n ?? {}) as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' && item.id ? item.id : `node-${idx + 1}`,
      type: (typeof item.type === 'string' ? item.type : 'OFFENSE_PLAYER') as TacticNode['type'],
      label: typeof item.label === 'string' ? item.label : undefined,
      x: clampCoord(item.x, 0.5),
      y: clampCoord(item.y, 0.5),
      color: typeof item.color === 'string' ? item.color : undefined,
      hasBall: Boolean(item.hasBall),
      rotation: typeof item.rotation === 'number' ? item.rotation : undefined,
      isQueue: Boolean(item.isQueue),
      queueCount: typeof item.queueCount === 'number' ? item.queueCount : undefined
    };
  });

  const rawPaths = Array.isArray(obj.paths) ? obj.paths : [];
  const paths: TacticPath[] = rawPaths
    .map((p, idx) => {
      const item = (p ?? {}) as Record<string, unknown>;
      const rawPoints = Array.isArray(item.points) ? item.points : [];
      const points = rawPoints.map((pt) => {
        const ptObj = (pt ?? {}) as Record<string, unknown>;
        return {
          x: clampCoord(ptObj.x, 0.5),
          y: clampCoord(ptObj.y, 0.5)
        };
      });

      const rawCp = item.controlPoint as Record<string, unknown> | undefined;
      const controlPoint =
        rawCp && typeof rawCp === 'object'
          ? {
              x: clampCoord(rawCp.x, 0.5),
              y: clampCoord(rawCp.y, 0.5)
            }
          : undefined;

      return {
        id: typeof item.id === 'string' && item.id ? item.id : `path-${idx + 1}`,
        type: (typeof item.type === 'string' ? item.type : 'RUN_PATH') as TacticPath['type'],
        stepNumber: typeof item.stepNumber === 'number' ? item.stepNumber : idx + 1,
        fromNodeId: typeof item.fromNodeId === 'string' ? item.fromNodeId : undefined,
        fromWaypointId: typeof item.fromWaypointId === 'string' ? item.fromWaypointId : undefined,
        toNodeId: typeof item.toNodeId === 'string' ? item.toNodeId : undefined,
        toWaypointId: typeof item.toWaypointId === 'string' ? item.toWaypointId : undefined,
        points,
        controlPoint,
        curved: Boolean(item.curved || controlPoint)
      };
    })
    .filter((p) => p.points.length >= 2);

  const rawZones = Array.isArray(obj.zones) ? obj.zones : [];
  const zones: TacticZone[] = rawZones.map((z, idx) => {
    const item = (z ?? {}) as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' && item.id ? item.id : `zone-${idx + 1}`,
      shape: item.shape === 'ELLIPSE' ? 'ELLIPSE' : 'RECT',
      x: clampCoord(item.x, 0.5),
      y: clampCoord(item.y, 0.5),
      width: Math.min(0.95, Math.max(0.05, Number(item.width) || 0.2)),
      height: Math.min(0.95, Math.max(0.05, Number(item.height) || 0.15)),
      rotation: typeof item.rotation === 'number' ? item.rotation : undefined,
      color: typeof item.color === 'string' ? item.color : '#22c55e',
      opacity: typeof item.opacity === 'number' ? item.opacity : 0.22,
      label: typeof item.label === 'string' ? item.label : undefined
    };
  });

  const rawKeyframes = Array.isArray(obj.keyframes) ? obj.keyframes : [];
  const keyframes: TacticKeyframe[] = rawKeyframes.map((kf, idx) => {
    const item = (kf ?? {}) as Record<string, unknown>;
    const rawStates =
      item.nodeStates && typeof item.nodeStates === 'object'
        ? (item.nodeStates as Record<string, unknown>)
        : {};
    const nodeStates: Record<string, TacticKeyframeNodeState> = {};
    for (const [nid, rawNs] of Object.entries(rawStates)) {
      const ns = (rawNs ?? {}) as Record<string, unknown>;
      nodeStates[nid] = {
        x: clampCoord(ns.x, 0.5),
        y: clampCoord(ns.y, 0.5),
        hasBall: typeof ns.hasBall === 'boolean' ? ns.hasBall : undefined,
        rotation: typeof ns.rotation === 'number' ? ns.rotation : undefined,
        visible: typeof ns.visible === 'boolean' ? ns.visible : true
      };
    }
    const rawBall =
      item.ballPosition && typeof item.ballPosition === 'object'
        ? (item.ballPosition as Record<string, unknown>)
        : undefined;
    return {
      id: typeof item.id === 'string' && item.id ? item.id : `kf-${idx}`,
      index: typeof item.index === 'number' ? item.index : idx,
      label: typeof item.label === 'string' ? item.label : undefined,
      durationMs: typeof item.durationMs === 'number' && item.durationMs > 0 ? item.durationMs : 1400,
      pauseAfterMs: typeof item.pauseAfterMs === 'number' ? item.pauseAfterMs : 300,
      nodeStates,
      activePathIds: Array.isArray(item.activePathIds)
        ? item.activePathIds.filter((id): id is string => typeof id === 'string')
        : undefined,
      ballPosition: rawBall
        ? {
            holderNodeId:
              typeof rawBall.holderNodeId === 'string' ? rawBall.holderNodeId : undefined,
            x: typeof rawBall.x === 'number' ? clampCoord(rawBall.x, 0.5) : undefined,
            y: typeof rawBall.y === 'number' ? clampCoord(rawBall.y, 0.5) : undefined
          }
        : undefined
    };
  });

  const hasV2Features =
    zones.length > 0 ||
    keyframes.length > 0 ||
    paths.some((p) => Boolean(p.controlPoint));

  const animationSettings =
    obj.animationSettings && typeof obj.animationSettings === 'object'
      ? (obj.animationSettings as TacticBoardAnimationSettings)
      : undefined;

  return {
    version: hasV2Features || obj.version === 2 ? 2 : 1,
    courtTemplate:
      typeof obj.courtTemplate === 'string'
        ? (obj.courtTemplate as TacticBoardData['courtTemplate'])
        : 'HALF_COURT_VERTICAL',
    nodes,
    paths,
    ...(zones.length > 0 ? { zones } : {}),
    ...(keyframes.length > 0 ? { keyframes } : {}),
    ...(animationSettings ? { animationSettings } : {})
  };
}

export function parseAndNormalizeAiExerciseJson(
  rawInput: string,
  clubId: string,
  visibility: VisibilityLevel = 'CLUB',
  ownerTeamId?: string,
  autoGenerateAnimation = false,
  createdByMemberId?: string
): Exercise[] {
  const trimmed = rawInput
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (!trimmed) {
    throw new Error('Bitte füge ein JSON-Objekt oder JSON-Array ein.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Ungültiges JSON-Format: ${err instanceof Error ? err.message : 'Syntaxfehler'}`
    );
  }

  const rawList: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  if (rawList.length === 0) {
    throw new Error('Das JSON-Array enthält keine Übungen.');
  }

  const now = new Date().toISOString();

  return rawList.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== 'object') {
      throw new Error(`Eintrag #${index + 1} ist kein gültiges Übungs-Objekt.`);
    }

    const item = rawItem as Record<string, unknown>;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '';
    if (!title) {
      throw new Error(`Übung #${index + 1} hat keinen gültigen "title".`);
    }

    const rawCats = (item.categories ?? {}) as Record<string, unknown>;
    const phases = (Array.isArray(rawCats.phases) ? rawCats.phases : ['GROUND_EXERCISE']) as TrainingPhaseCategory[];
    const validFocus = new Set<string>([
      ...TACTIC_FOCUS_TAGS,
      ...TECHNIQUE_FOCUS_TAGS,
      ...ATHLETICS_RECOVERY_FOCUS_TAGS
    ]);
    const rawFocus = Array.isArray(rawCats.focus) ? rawCats.focus : ['OFFENSE_GROUP'];
    const legacyTechniques = Array.isArray(rawCats.techniques)
      ? rawCats.techniques.map((t) => (t === 'GOALKEEPER_SAVE' ? 'GOALKEEPER_TECHNIQUE' : t))
      : [];
    const focus = Array.from(
      new Set(
        [...rawFocus, ...legacyTechniques].filter(
          (f): f is HandballFocusTag => typeof f === 'string' && validFocus.has(f)
        )
      )
    );
    if (focus.length === 0) {
      if (phases.includes('COOL_DOWN')) focus.push('REGENERATION_MOBILITY');
      else if (phases.includes('ATHLETICS_COORDINATION')) focus.push('ATHLETICS_CONDITIONING');
      else focus.push('OFFENSE_GROUP');
    }
    const level = (typeof rawCats.level === 'string' ? rawCats.level : 'BASIC') as ComplexityLevel;
    const validAgeGroups = new Set<string>(ALL_AGE_GROUPS);
    const parsedAgeGroups = Array.isArray(rawCats.age_groups)
      ? (rawCats.age_groups.filter(
          (ag): ag is AgeGroup => typeof ag === 'string' && validAgeGroups.has(ag)
        ) as AgeGroup[])
      : [];
    const age_groups = parsedAgeGroups.length > 0 ? parsedAgeGroups : DEFAULT_AGE_GROUPS;

    const rawMaterials = Array.isArray(item.materials) ? item.materials : [];
    const materials: MaterialItem[] = rawMaterials
      .map((m) => {
        const mObj = (m ?? {}) as Record<string, unknown>;
        return {
          type: (typeof mObj.type === 'string' ? mObj.type : 'BALL') as MaterialType,
          quantity: typeof mObj.quantity === 'number' && mObj.quantity > 0 ? mObj.quantity : 1
        };
      });

    return {
      id: crypto.randomUUID(),
      club_id: clubId,
      ...(createdByMemberId ? { created_by_member_id: createdByMemberId } : {}),
      visibility,
      owner_team_id: visibility === 'TEAM' ? ownerTeamId : undefined,
      title,
      default_duration_min:
        typeof item.default_duration_min === 'number' && item.default_duration_min > 0
          ? item.default_duration_min
          : 15,
      min_players:
        typeof item.min_players === 'number' && item.min_players > 0 ? item.min_players : 6,
      max_players:
        typeof item.max_players === 'number' && item.max_players > 0 ? item.max_players : 14,
      goalkeepers:
        typeof item.goalkeepers === 'number' && item.goalkeepers >= 0 ? item.goalkeepers : 1,
      categories: { phases, focus, level, age_groups },
      materials,
      setup_description:
        typeof item.setup_description === 'string' ? item.setup_description : '',
      flow_description:
        typeof item.flow_description === 'string' ? item.flow_description : '',
      coaching_points:
        typeof item.coaching_points === 'string' ? item.coaching_points : '',
      variations_text:
        typeof item.variations_text === 'string' ? item.variations_text : '',
      source_url: typeof item.source_url === 'string' ? sanitizeHttpUrl(item.source_url) : undefined,
      external_links: [],
      tactic_board_data: (() => {
        const board = normalizeTacticBoard(item.tactic_board_data);
        if (
          board &&
          autoGenerateAnimation &&
          (!board.keyframes || board.keyframes.length === 0) &&
          board.paths.length > 0
        ) {
          return generateKeyframesFromPaths(board);
        }
        return board;
      })(),
      is_deleted: false,
      created_at: now,
      updated_at: now
    };
  });
}
