import type { ThemeId } from './themes.ts';

export type Mode = 'cpu' | 'hotseat' | 'watch';
export type Brain = 'easy' | 'normal' | 'hard' | 'troll';

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
