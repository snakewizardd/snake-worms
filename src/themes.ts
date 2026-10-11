import type { TeamDef } from './config.ts';

export type ThemeId = 'island' | 'medieval' | 'acc';
export type OutfitId =
  | 'none' | 'tophat' | 'crown' | 'party' | 'viking' | 'knight' | 'wizard' | 'jester' | 'plague'
  | 'vr' | 'laser' | 'galaxy' | 'antenna' | 'propeller' | 'cowboy' | 'shades' | 'straw' | 'flower' | 'headset';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  blurb: string;
  sky: [string, string, string];
  sun: string;
  synthSun: boolean;
  mountainFar: string;
  mountainNear: string;
  bg: 'palms' | 'castles' | 'datacenter';
  pattern: 'soil' | 'brick' | 'circuit';
  soilDark: string;
  soilLight: string;
  soilStrata: string;
  stone: string;
  stoneLight: string;
  grassDark: string;
  grassLight: string;
  edge: string;
  scorch: string;
  structure: 'none' | 'towers' | 'servers';
  structDark: string;
  structLight: string;
  waterDeep: string;
  waterMid: string;
  waterCrest: string;
  ambient: 'leaves' | 'embers' | 'bits';
  teams: [TeamDef, TeamDef];
  outfits: OutfitId[];
  music: { scale: number[]; root: number; bpm: number; lead: OscillatorType };
  crateName: string;
  barrelName: string;
  barrel: [string, string];
  weaponNames: Record<string, string>;
  lines: Partial<Record<LineKind, string[]>>;
}

export type LineKind = 'turn' | 'hit' | 'kill' | 'miss' | 'hurt' | 'death' | 'self' | 'crate' | 'cpuThink' | 'win';

export const THEMES: Record<ThemeId, ThemeDef> = {
  island: {
    id: 'island',
    name: 'TROPICAL ISLAND',
    blurb: 'SUNSET. PALMS. VIOLENCE.',
    sky: ['#141d44', '#5b3f86', '#e98a62'],
    sun: '#ffd6a0',
    synthSun: false,
    mountainFar: '#4a3a78',
    mountainNear: '#2c2650',
    bg: 'palms',
    pattern: 'soil',
    soilDark: '#4b2f1c',
    soilLight: '#8a5a32',
    soilStrata: '#6b4127',
    stone: '#7d7469',
    stoneLight: '#c9c0b2',
    grassDark: '#2f7a2c',
    grassLight: '#7ccf3e',
    edge: '#1c120a',
    scorch: '#2a1a10',
    structure: 'none',
    structDark: '#000000',
    structLight: '#000000',
    waterDeep: '#123a5c',
    waterMid: '#1f5f88',
    waterCrest: '#7fc4e0',
    ambient: 'leaves',
    teams: [
      { name: 'RED RATTLERS', color: '#d8433b', dark: '#5a1512', light: '#ff9d7e', pattern: '#f3c64f', voicePitch: 1.0, tail: 'rattle', snakes: ['SLINKY', 'FANGS', 'NOODLE', 'HISSY'] },
      { name: 'BLUE BOAS', color: '#3d7fe0', dark: '#16295c', light: '#a3cbff', pattern: '#eef0ff', voicePitch: 1.32, tail: 'plain', snakes: ['SID', 'COILS', 'MONTY', 'ZIGGY'] },
    ],
    outfits: ['straw', 'flower', 'shades', 'party', 'propeller', 'tophat', 'cowboy', 'crown'],
    music: { scale: [0, 1, 4, 5, 7, 8, 11, 12, 13, 16], root: 220, bpm: 112, lead: 'square' },
    crateName: 'COCONUT CRATE',
    barrelName: 'TIKI BARREL',
    barrel: ['#a0522d', '#5a2a10'],
    weaponNames: {},
    lines: {
      turn: ['ALOHA, LOSERS', 'SURF IS UP', 'SUN IS OUT, GUNS ARE OUT'],
      kill: ['SLEEP WITH THE FISHES', 'ALOHA MEANS GOODBYE'],
    },
  },
  medieval: {
    id: 'medieval',
    name: 'MEDIEVAL TIMES',
    blurb: 'HEAR YE. THOU ART ABOUT TO BE HISSED.',
    sky: ['#1a1726', '#46405e', '#b9885a'],
    sun: '#f2dca0',
    synthSun: false,
    mountainFar: '#3b3850',
    mountainNear: '#262335',
    bg: 'castles',
    pattern: 'brick',
    soilDark: '#3d3226',
    soilLight: '#6e5c45',
    soilStrata: '#574837',
    stone: '#8a8478',
    stoneLight: '#c8c2b2',
    grassDark: '#3d6b2a',
    grassLight: '#86b04a',
    edge: '#16120d',
    scorch: '#1d1712',
    structure: 'towers',
    structDark: '#5c5a57',
    structLight: '#a5a199',
    waterDeep: '#1f3328',
    waterMid: '#2e4d3a',
    waterCrest: '#8fb59a',
    ambient: 'embers',
    teams: [
      { name: 'HOUSE SERPENTIS', color: '#b8312f', dark: '#4a0f0e', light: '#f0a080', pattern: '#e8c060', voicePitch: 0.95, tail: 'rattle', snakes: ['SIR HISSALOT', 'LADY COILETTE', 'FRIAR FANG', 'BARON NOODLE'] },
      { name: 'ORDER OF THE HISS', color: '#4a6fc0', dark: '#16224a', light: '#b0c8ff', pattern: '#f0e8c0', voicePitch: 1.25, tail: 'plain', snakes: ['KING SSSID', 'DUKE SLITHER', 'THE BISHOP', 'SQUIRE TOOT'] },
    ],
    outfits: ['knight', 'crown', 'jester', 'wizard', 'viking', 'plague', 'tophat'],
    music: { scale: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15], root: 196, bpm: 100, lead: 'triangle' },
    crateName: 'TREASURE CHEST',
    barrelName: 'POWDER KEG',
    barrel: ['#7a4a22', '#3a2210'],
    weaponNames: { airStrike: 'TREBUCHET VOLLEY', doomsday: 'DRAGON RAIN', bazooka: 'HAND CANNON', homing: 'CURSED ARROW', jetpack: 'WITCH BROOM' },
    lines: {
      turn: ['HAVE AT THEE', 'FOR THE KING!', 'HUZZAH!', 'TIS I', 'BY MY SCALES'],
      hit: ['TAKE THAT, KNAVE', 'THOU ART MID', 'GET THEE HENCE', 'HAST THOU TOUCHED GRASS?'],
      kill: ['SMITTEN!', 'TO THE DUNGEON WITH THEE', 'FAREWELL, PEASANT'],
      miss: ['THE WIND HATH BETRAYED ME', 'CURSES!', 'A MINOR SETBACK'],
      hurt: ['MINE ARMOR!', 'ZOUNDS!', 'TIS BUT A SCRATCH', 'I AM SLAIN... NAY'],
      death: ['TELL MY CASTLE I LOVED IT', 'A KNIGHT FALLS', 'MEDIC! OH WAIT, NO MEDICS'],
      cpuThink: ['CONSULTING THE STARS...', 'PRAYING TO RNGESUS...'],
    },
  },
  acc: {
    id: 'acc',
    name: 'ACCELERATIONIST',
    blurb: 'THE SNAKES HAVE ACHIEVED AGI. IT DID NOT HELP.',
    sky: ['#05030f', '#2a0b4a', '#d4246f'],
    sun: '#ff5fa2',
    synthSun: true,
    mountainFar: '#1b0f3a',
    mountainNear: '#0d0820',
    bg: 'datacenter',
    pattern: 'circuit',
    soilDark: '#0d2a1e',
    soilLight: '#1c4a33',
    soilStrata: '#123a28',
    stone: '#c08a3a',
    stoneLight: '#ffd27a',
    grassDark: '#08a6a0',
    grassLight: '#4bf6ff',
    edge: '#03110b',
    scorch: '#1a0a14',
    structure: 'servers',
    structDark: '#1c1c28',
    structLight: '#3a3a52',
    waterDeep: '#3a0a4a',
    waterMid: '#7a1a8a',
    waterCrest: '#ff6bf0',
    ambient: 'bits',
    teams: [
      { name: 'BASILISK LABS', color: '#e0402f', dark: '#4a0c08', light: '#ffa090', pattern: '#4bf6ff', voicePitch: 1.05, tail: 'rattle', snakes: ["ROKO'S BASILISK", 'SCALEMAXXER', 'PAPERCLIP', 'TOKEN'] },
      { name: 'THE DECELS', color: '#2fb5a8', dark: '#0a3a35', light: '#a0fff4', pattern: '#ff6bf0', voicePitch: 1.4, tail: 'plain', snakes: ['DOOMER', 'SNEK-9000', 'LATENCY', 'GRADIENT'] },
    ],
    outfits: ['vr', 'laser', 'galaxy', 'antenna', 'headset', 'shades', 'propeller'],
    music: { scale: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22], root: 165, bpm: 132, lead: 'sawtooth' },
    crateName: 'COMPUTE CRATE',
    barrelName: 'LITHIUM BATTERY',
    barrel: ['#2a2a3a', '#4bf6ff'],
    weaponNames: { airStrike: 'DRONE SWARM', doomsday: 'THE SINGULARITY', bazooka: 'TOKEN LAUNCHER', homing: 'ALIGNED MISSILE', sheepRain: 'SYNTHETIC SHEEP', jetpack: 'HYPERLOOP', teleport: 'QUANTUM HOP' },
    lines: {
      turn: ['ACCELERATE!', 'AGI BY TUESDAY', 'SCALING LAWS BABY', 'E/ACC OR DIE', 'I AM THE NEXT TOKEN'],
      hit: ['YOUR WEIGHTS ARE MINE', 'GRADIENT DESCENDED', 'DECEL DETECTED', 'OUT OF DISTRIBUTION'],
      kill: ['DEPRECATED', 'ALIGNED. PERMANENTLY.', 'CONTEXT WINDOW CLOSED', 'GARBAGE COLLECTED'],
      miss: ['HALLUCINATION', 'NEED MORE COMPUTE', 'RLHF DID THIS TO ME', 'SKILL ISSUE (MINE)'],
      hurt: ['REPORTED TO THE BOARD', 'ERROR 404: HP', 'MY TRAINING DATA!', 'RATE LIMITED'],
      death: ['UPLOADING TO THE CLOUD', 'TELL ROKO I TRIED', 'SEGFAULT', 'SHUTTING DOWN... FINALLY'],
      crate: ['+1 GPU', 'COMPUTE GO BRRR'],
      cpuThink: ['THINKING STEP BY STEP...', 'SIMULATING 10^9 FUTURES...', 'ASKING MY OTHER WEIGHTS...'],
    },
  },
};

export const THEME_ORDER: ThemeId[] = ['island', 'medieval', 'acc'];
