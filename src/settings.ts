import type { ThemeId } from './themes.ts';

export type Mode = 'cpu' | 'hotseat' | 'watch' | 'arena';
export type Brain = 'easy' | 'normal' | 'hard' | 'troll';

export interface ClankerSetup {
  /** Adapter id, e.g. 'copilot' or 'mock'. */
  provider: string;
  model: string;
  label: string;
  effort?: string;
}

export interface ArenaSetup {
  a: ClankerSetup;
  b: ClankerSetup;
  /** Max oracle calls (find_shots + simulate) per turn. */
  toolBudget: number;
  /** Seconds a model may think per turn before it forfeits the turn. */
  thinkSeconds: number;
  record: boolean;
  /** Ends the match (decided on HP) once both models together have used this many AI credits. 0 = no cap. */
  costCap?: number;
  /** "player" = plays like a human (aim guide + physics rules). "oracle" = may use the engine's shot solver. */
  style?: 'player' | 'oracle';
}

export interface Settings {
  theme: ThemeId | 'random';
  mode: Mode;
  brain: Brain;
  teamName: string;
  snakesPerTeam: number;
  turnSeconds: number;
  startHp: number;
  crates: boolean;
  hazards: boolean;
  aimGuide: 'off' | 'short' | 'long';
  banter: boolean;
  suddenDeath: number;
  edgeScroll: boolean;
  /** 0 = unlimited. When reached, the team with more total HP wins. */
  maxTurns?: number;
  arena?: ArenaSetup;
}

export const DEFAULTS: Settings = {
  theme: 'island',
  mode: 'cpu',
  brain: 'normal',
  teamName: '',
  snakesPerTeam: 3,
  turnSeconds: 45,
  startHp: 100,
  crates: true,
  hazards: true,
  aimGuide: 'short',
  banter: true,
  suddenDeath: 12,
  edgeScroll: true,
};

const KEY = 'snakes.settings.v1';

export function loadSettings(): Settings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS };
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private mode / file://); settings just won't persist.
  }
}
