import type { CourtTemplate, TacticBoardData, TacticNode } from '../types/domain';

export interface TacticPresetOption {
  id: string;
  label: string;
  category: 'OFFENSE' | 'DEFENSE' | 'COMBINED';
  description: string;
}

export const TACTIC_PRESETS: TacticPresetOption[] = [
  {
    id: 'COMBINED_6_0_VS_3_3',
    label: 'Angriff 3:3 gg. 6:0-Abwehr',
    category: 'COMBINED',
    description: 'Komplette 6gg6 Grundaufstellung mit Torwart'
  },
  {
    id: 'COMBINED_3_2_1_VS_3_3',
    label: 'Angriff 3:3 gg. 3:2:1-Abwehr',
    category: 'COMBINED',
    description: 'Offensiver 3:2:1-Deckungsverband gegen 3:3-Angriff'
  },
  {
    id: 'OFFENSE_BACKCOURT_TRIANGLE',
    label: 'Stoß-Dreieck (RL-RM-RR + KM)',
    category: 'OFFENSE',
    description: 'Klassische Trainingsaufstellung mit Anstellreihen auf RL/RR'
  },
  {
    id: 'OFFENSE_3_3',
    label: 'Angriff 3:3 (LA–RA + KM)',
    category: 'OFFENSE',
    description: '6 Angreifer in Grundposition ohne Abwehr'
  },
  {
    id: 'DEFENSE_6_0',
    label: '6:0-Abwehr + TW',
    category: 'DEFENSE',
    description: 'Geschlossener 6:0-Riegel am 6m-Raum'
  },
  {
    id: 'DEFENSE_5_1',
    label: '5:1-Abwehr (mit VM) + TW',
    category: 'DEFENSE',
    description: '5:1-Abwehr mit vorgezogenem Vorne-Mitte auf 9m'
  },
  {
    id: 'DEFENSE_3_2_1',
    label: '3:2:1-Abwehr + TW',
    category: 'DEFENSE',
    description: 'Gestaffelte 3:2:1-Abwehr (HM, AL/AR, HL/HR, VM)'
  }
];

function createOffense33Nodes(): TacticNode[] {
  return [
    { id: 'off-la', type: 'OFFENSE_PLAYER', label: 'LA', x: 0.10, y: 0.16, color: '#2563eb' },
    { id: 'off-rl', type: 'OFFENSE_PLAYER', label: 'RL', x: 0.24, y: 0.48, color: '#2563eb' },
    { id: 'off-rm', type: 'OFFENSE_PLAYER', label: 'RM', x: 0.50, y: 0.54, color: '#2563eb', hasBall: true },
    { id: 'off-rr', type: 'OFFENSE_PLAYER', label: 'RR', x: 0.76, y: 0.48, color: '#2563eb' },
    { id: 'off-ra', type: 'OFFENSE_PLAYER', label: 'RA', x: 0.90, y: 0.16, color: '#2563eb' },
    { id: 'off-km', type: 'OFFENSE_PLAYER', label: 'KM', x: 0.45, y: 0.25, color: '#2563eb' }
  ];
}

function createDefense60Nodes(): TacticNode[] {
  return [
    { id: 'def-tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
    { id: 'def-al', type: 'DEFENSE_PLAYER', label: 'AL', x: 0.16, y: 0.16, color: '#dc2626' },
    { id: 'def-hl', type: 'DEFENSE_PLAYER', label: 'HL', x: 0.29, y: 0.23, color: '#dc2626' },
    { id: 'def-il', type: 'DEFENSE_PLAYER', label: 'IL', x: 0.43, y: 0.26, color: '#dc2626' },
    { id: 'def-ir', type: 'DEFENSE_PLAYER', label: 'IR', x: 0.57, y: 0.26, color: '#dc2626' },
    { id: 'def-hr', type: 'DEFENSE_PLAYER', label: 'HR', x: 0.71, y: 0.23, color: '#dc2626' },
    { id: 'def-ar', type: 'DEFENSE_PLAYER', label: 'AR', x: 0.84, y: 0.16, color: '#dc2626' }
  ];
}

function createDefense51Nodes(): TacticNode[] {
  return [
    { id: 'def-tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
    { id: 'def-al', type: 'DEFENSE_PLAYER', label: 'AL', x: 0.16, y: 0.16, color: '#dc2626' },
    { id: 'def-hl', type: 'DEFENSE_PLAYER', label: 'HL', x: 0.31, y: 0.24, color: '#dc2626' },
    { id: 'def-hm', type: 'DEFENSE_PLAYER', label: 'HM', x: 0.50, y: 0.24, color: '#dc2626' },
    { id: 'def-hr', type: 'DEFENSE_PLAYER', label: 'HR', x: 0.69, y: 0.24, color: '#dc2626' },
    { id: 'def-ar', type: 'DEFENSE_PLAYER', label: 'AR', x: 0.84, y: 0.16, color: '#dc2626' },
    { id: 'def-vm', type: 'DEFENSE_PLAYER', label: 'VM', x: 0.50, y: 0.38, color: '#dc2626' }
  ];
}

function createDefense321Nodes(): TacticNode[] {
  return [
    { id: 'def-tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
    { id: 'def-al', type: 'DEFENSE_PLAYER', label: 'AL', x: 0.16, y: 0.16, color: '#dc2626' },
    { id: 'def-hm', type: 'DEFENSE_PLAYER', label: 'HM', x: 0.50, y: 0.25, color: '#dc2626' },
    { id: 'def-ar', type: 'DEFENSE_PLAYER', label: 'AR', x: 0.84, y: 0.16, color: '#dc2626' },
    { id: 'def-hl', type: 'DEFENSE_PLAYER', label: 'HL', x: 0.30, y: 0.31, color: '#dc2626' },
    { id: 'def-hr', type: 'DEFENSE_PLAYER', label: 'HR', x: 0.70, y: 0.31, color: '#dc2626' },
    { id: 'def-vm', type: 'DEFENSE_PLAYER', label: 'VM', x: 0.50, y: 0.40, color: '#dc2626' }
  ];
}

export function buildTacticBoardPreset(
  presetId: string,
  courtTemplate: CourtTemplate = 'HALF_COURT_VERTICAL'
): TacticBoardData {
  let nodes: TacticNode[] = [];

  switch (presetId) {
    case 'OFFENSE_3_3':
      nodes = [
        { id: 'def-tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
        ...createOffense33Nodes()
      ];
      break;
    case 'OFFENSE_BACKCOURT_TRIANGLE':
      nodes = [
        { id: 'def-tw', type: 'GOALKEEPER', label: 'TW', x: 0.50, y: 0.08, color: '#10b981' },
        {
          id: 'off-rl',
          type: 'OFFENSE_PLAYER',
          label: 'RL',
          x: 0.22,
          y: 0.48,
          color: '#2563eb',
          hasBall: true,
          isQueue: true,
          queueCount: 3
        },
        {
          id: 'off-rm',
          type: 'OFFENSE_PLAYER',
          label: 'RM',
          x: 0.50,
          y: 0.52,
          color: '#2563eb',
          isQueue: true,
          queueCount: 2
        },
        {
          id: 'off-rr',
          type: 'OFFENSE_PLAYER',
          label: 'RR',
          x: 0.78,
          y: 0.48,
          color: '#2563eb',
          isQueue: true,
          queueCount: 3
        },
        { id: 'off-km', type: 'OFFENSE_PLAYER', label: 'KM', x: 0.45, y: 0.25, color: '#2563eb' },
        { id: 'def-il', type: 'DEFENSE_PLAYER', label: 'IL', x: 0.39, y: 0.25, color: '#dc2626' },
        { id: 'def-ir', type: 'DEFENSE_PLAYER', label: 'IR', x: 0.57, y: 0.25, color: '#dc2626' }
      ];
      break;
    case 'DEFENSE_6_0':
      nodes = createDefense60Nodes();
      break;
    case 'DEFENSE_5_1':
      nodes = createDefense51Nodes();
      break;
    case 'DEFENSE_3_2_1':
      nodes = createDefense321Nodes();
      break;
    case 'COMBINED_3_2_1_VS_3_3':
      nodes = [...createDefense321Nodes(), ...createOffense33Nodes()];
      break;
    case 'COMBINED_6_0_VS_3_3':
    default:
      nodes = [...createDefense60Nodes(), ...createOffense33Nodes()];
      break;
  }

  return {
    version: 1,
    courtTemplate,
    presetUsed: presetId,
    nodes,
    paths: []
  };
}
