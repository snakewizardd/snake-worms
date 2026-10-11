import type { LineKind, ThemeDef, ThemeId } from './themes.ts';
import { rng } from './util.ts';

const GENERIC: Record<LineKind, string[]> = {
  turn: ['MY TURN, NERDS', 'WATCH THIS', 'HOLD MY VENOM', 'HERE GOES NOTHING', 'TRUST THE PROCESS', 'NO THOUGHTS, HEAD EMPTY', 'LOCKED IN', 'IT IS GIVING... VIOLENCE', 'MAIN CHARACTER MOMENT'],
  hit: ['GET REKT', 'SKILL ISSUE', 'L + RATIO', 'SIT DOWN', 'HISSSS-TERICAL', 'TOO EASY', 'CRY ABOUT IT', 'EZ CLAP', 'NOT EVEN CLOSE, BABY', 'STAY HUMBLE'],
  kill: ['GG EZ', 'DEAL WITH IT', 'DELETED', 'UNINSTALL', 'NO RE', 'OUTPLAYED', 'AND STAY DOWN', 'RENT FREE'],
  miss: ['WIND NERF WHEN', 'LAG', 'I MEANT TO DO THAT', 'WARNING SHOT', 'MY CONTROLLER IS BROKEN', 'CALCULATED.', 'OOPS', 'THE SUN WAS IN MY EYES'],
  hurt: ['BRO??', 'REPORTED', 'OUCH, MY EVERYTHING', 'RUDE', 'HACKS', 'WHY ME', 'I FELT THAT', 'NOT THE FACE'],
  death: ['TELL MY EGGS I LOVE THEM', 'GG NO RE', 'I REGRET NOTHING', 'RESPAWN WHEN?', 'BYE BYE', 'THIS IS FINE', 'AVENGE ME'],
  self: ['I MEANT THAT', 'TACTICAL', 'TRIPPED', 'FRIENDLY FIRE IS STILL FIRE', 'TOTALLY PLANNED'],
  crate: ['OOH SHINY', 'LOOT!', 'FREE STUFF', 'MINE NOW', 'BIRTHDAY?!'],
  cpuThink: ['CALCULATING...', 'HMMMM...', 'DOING MATHS...', 'BIG BRAIN TIME...'],
  win: ['GG', 'TOO EASY', 'WE ARE SO BACK', 'UNDEFEATED'],
};

const TROLL = ['TOUCH GRASS', 'IMAGINE LOSING TO A SNAKE', 'NICE AIM (NOT)', 'UNLUCKY', 'YOU GOOD BRO?', 'I LET YOU HIT THAT', 'COPE', 'MALDING?', 'ZERO DAMAGE TAKEN (EMOTIONALLY)', 'SKILL DIFF', 'CHAT IS THIS REAL', 'BOT DIFF', 'I AM SPEED'];
const TROLL_SKIP = ['I WILL LET YOU COOK', 'AFK, GETTING SNACKS', 'PACIFIST RUN', 'TOO EASY. SKIPPING.'];
const TROLL_GIRDER = ['BUILT A HOUSE FOR YOU', 'BOX IS SAFE', 'GIRDER GANG', 'LEGO TIME'];

export function line(kind: LineKind, theme: ThemeDef, cpuTroll = false): string {
  const themed = theme.lines[kind] ?? [];
  const pool = [...GENERIC[kind], ...themed, ...themed];
  if (cpuTroll && (kind === 'hit' || kind === 'kill' || kind === 'turn' || kind === 'miss')) pool.push(...TROLL);
  return rng.pick(pool);
}

export function trollLine(kind: 'skip' | 'girder'): string {
  return rng.pick(kind === 'skip' ? TROLL_SKIP : TROLL_GIRDER);
}

const KILL_FEED: Record<ThemeId | 'any', string[]> = {
  any: ['{n} HAS LEFT THE CHAT', '{n} WAS YEETED', '{n} IS NOW A BELT', 'RIP {n}', '{n} WENT TO THE SHADOW REALM', '{n}: CONNECTION LOST', '{n} GOT DELETED'],
  island: ['{n} IS COCONUT NOW'],
  medieval: ['{n} HATH PERISHED', '{n} WAS SMOTE'],
  acc: ['{n} WAS DEPRECATED', '{n} RETURNED NULL', '{n} HIT THE TOKEN LIMIT'],
};

const DROWN_FEED = ['{n} IS SLEEPING WITH THE FISHES', '{n} WENT FOR A SWIM. FOREVER.', '{n} FORGOT HOW TO SWIM', '{n} IS NOW SUSHI', '{n} CHOSE THE SEA'];

export function killFeed(name: string, theme: ThemeDef): string {
  return rng.pick([...KILL_FEED.any, ...KILL_FEED[theme.id]]).replace('{n}', name);
}

export function drownFeed(name: string): string {
  return rng.pick(DROWN_FEED).replace('{n}', name);
}

export function multiKill(n: number): string {
  return n >= 4 ? 'SNAKEPOCALYPSE!' : n === 3 ? 'TRIPLE KILL!' : 'DOUBLE KILL!';
}
