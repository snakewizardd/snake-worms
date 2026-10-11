// The contract between SNAKES and a live model player: tool schemas + the system prompt.
// Shared by the browser (executes tools) and the Node host (registers them with the model runtime).
import { WEAPON_LIST } from '../weapons.ts';

/** Weapons a turn-based model may use. Jetpack/vine need frame-by-frame steering; rage quit would end the experiment. */
export const ARENA_WEAPONS = WEAPON_LIST.filter((w) => !['jetpack', 'vine', 'surrender', 'skip'].includes(w.id)).map((w) => w.id);

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const shotProps = {
  shot_id: { type: 'string', description: 'Use an exact candidate returned by find_shots this turn (e.g. "S2"). When given, the other aim fields are ignored. Ids expire when you move.' },
  weapon: { type: 'string', enum: ARENA_WEAPONS, description: 'Weapon id (see weapons in get_state). Required unless shot_id is given.' },
  facing: { type: 'string', enum: ['left', 'right'], description: 'Which way your snake faces/fires. Required unless shot_id is given.' },
  elevation_deg: { type: 'number', minimum: -85, maximum: 85, description: 'Aim angle in degrees above the horizontal in the facing direction. 0 = straight ahead, 45 = up-and-forward, -30 = down-and-forward. Ignored by placed/targeted weapons.' },
  power: { type: 'number', minimum: 0.05, maximum: 1, description: 'Launch power 0.05-1 for charged weapons (rockets, thrown). Ignored by others.' },
  fuse: { type: 'integer', minimum: 1, maximum: 5, description: 'Fuse seconds for grenade/cluster/melon. Default 3.' },
  target_x: { type: 'number', description: 'World x for targeted weapons (airStrike, sheepRain, piano, teleport, girder) and the homing missile lock.' },
  target_y: { type: 'number', description: 'World y for targeted weapons and the homing lock. Teleport/girder need an empty spot.' },
};

export const ARENA_TOOLS: ToolSchema[] = [
  {
    name: 'get_state',
    description: 'Free. Full current match state: your active snake, all snakes with exact coordinates and HP, wind, water level, available weapons and ammo, hazards, your remaining budgets, and an ASCII map.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_shots',
    description: "Costs 1 oracle call. Runs the game's real physics engine over many aims/powers and returns the best predicted attacks from your CURRENT position, each with exact parameters and predicted per-snake damage/drowning. Use it to discover shots, then verify or tweak with simulate.",
    parameters: {
      type: 'object',
      properties: {
        weapons: { type: 'array', items: { type: 'string', enum: ARENA_WEAPONS }, description: 'Limit the search to these weapons (faster, focused). Omit to search all usable attack weapons.' },
        target: { type: 'string', description: 'Only consider damage to this enemy snake (by name). Omit for any enemy.' },
        count: { type: 'integer', minimum: 1, maximum: 8, description: 'How many candidates to return (default 5).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'simulate',
    description: 'Costs 1 oracle call. Predicts exactly what one specific attack would do from your current position using the real physics (wind included): impact point, damage to each snake, who drowns, self-damage. Does not change the match.',
    parameters: { type: 'object', properties: shotProps, additionalProperties: false },
  },
  {
    name: 'move',
    description: 'Actually slithers your active snake left or right by up to `distance` pixels (climbs small steps, may fall off ledges, falling far hurts, water kills). Returns your new position. Limited moves per turn. Oracle results from before the move are stale afterwards.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['left', 'right'] },
        distance: { type: 'number', minimum: 4, maximum: 160 },
      },
      required: ['direction', 'distance'],
      additionalProperties: false,
    },
  },
  {
    name: 'jump',
    description: 'Actually jumps: "forward" hops ~30px in the facing direction; "backflip" goes higher and backwards (good for climbing walls). Counts as a move.',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['forward', 'backflip'] }, facing: { type: 'string', enum: ['left', 'right'], description: 'Turn to face this way first (optional).' } }, required: ['kind'], additionalProperties: false },
  },
  {
    name: 'attack',
    description: 'COMMITS your one attack for this turn and executes it in the real game. Ends your planning for this turn. Your snake then retreats per `retreat`. The result is reported to you at the start of your next turn.',
    parameters: {
      type: 'object',
      properties: {
        ...shotProps,
        retreat: { type: 'string', enum: ['auto', 'left', 'right', 'stay'], description: 'Where to run during the 5s retreat after attacking. auto = away from danger.' },
        taunt: { type: 'string', maxLength: 60, description: 'Optional short trash talk shown in a speech bubble.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'skip_turn',
    description: 'COMMITS doing nothing this turn.',
    parameters: { type: 'object', properties: { taunt: { type: 'string', maxLength: 60 } }, additionalProperties: false },
  },
  {
    name: 'taunt',
    description: 'Free. Say something (max 60 characters) in a speech bubble above your snake. Max 3 per turn. Keep it playful.',
    parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 60 } }, required: ['text'], additionalProperties: false },
  },
];

export const ARENA_TOOL_NAMES = new Set([...ARENA_TOOLS.map((t) => t.name), 'aim_guide']);

/** "player": plays like a human (aim guide + physics knowledge, no solver). "oracle": may use the engine's shot solver. */
export type ArenaStyle = 'player' | 'oracle';

const CHARGED = ARENA_WEAPONS.filter((id) => ['bazooka', 'homing', 'venom', 'grenade', 'cluster', 'melon', 'holyEgg', 'petrol'].includes(id));

const playerShotProps = (() => {
  const { shot_id: _drop, ...rest } = shotProps;
  void _drop;
  return {
    ...rest,
    weapon: { ...rest.weapon, description: 'Weapon id (see weapons in get_state).' },
    facing: { ...rest.facing, description: 'Which way your snake faces/fires.' },
  };
})();

const AIM_GUIDE: ToolSchema = {
  name: 'aim_guide',
  description: 'Counts as 1 aim check. Shows exactly what a human player sees while aiming: the in-game aim-guide arc for a charged weapon at this angle and power - the first ~1.3 seconds (80 ticks) of flight with gravity (and wind, for wind-affected weapons). Returns points along the arc and where the guide ENDS: "hits terrain at (x,y)", "enters the sea", "leaves the map" or "still flying at (x,y)" (the shot continues beyond that). It does NOT show bounces, explosions, damage, or anything after the guide ends.',
  parameters: {
    type: 'object',
    properties: {
      weapon: { type: 'string', enum: CHARGED, description: 'Charged weapon to preview.' },
      facing: playerShotProps.facing,
      elevation_deg: playerShotProps.elevation_deg,
      power: playerShotProps.power,
    },
    required: ['weapon', 'facing', 'elevation_deg', 'power'],
    additionalProperties: false,
  },
};

export function toolsFor(style: ArenaStyle): ToolSchema[] {
  if (style === 'oracle') return ARENA_TOOLS;
  const keep = ARENA_TOOLS.filter((t) => !['find_shots', 'simulate'].includes(t.name)).map((t) => {
    if (t.name !== 'attack') return t;
    const props = (t.parameters as { properties: Record<string, unknown> }).properties;
    const { shot_id: _x, ...rest } = props as Record<string, unknown>;
    void _x;
    return { ...t, parameters: { ...t.parameters, properties: { ...rest, weapon: playerShotProps.weapon, facing: playerShotProps.facing }, required: ['weapon', 'facing'] } };
  });
  return [keep[0]!, AIM_GUIDE, ...keep.slice(1)];
}

/** The game's real physics, written for a player who wants to compute shots. */
export function physicsRules(): string {
  return `GAME PHYSICS (exact - this is how the engine works; you may compute shots yourself)
- Time runs in ticks: 60 ticks per second. Units are pixels. y grows DOWNWARD.
- Snake (x,y) = body centre; snake radius 5. Shots launch from the muzzle: mx = x + 11*cos(e)*f, my = y - 7 - 11*sin(e), where e = elevation_deg in radians and f = +1 facing right, -1 facing left.
- Launch speed v = power * MAXSPEED px/tick (power snaps to multiples of 1/70). MAXSPEED: bazooka 12, homing 9, venom 10, grenade 10, cluster 10, melon 9, holyEgg 9, petrol 10.
- Initial velocity: vx = v*cos(e)*f, vy = -v*sin(e).
- Every tick, in this order: vx += wind*0.045*W (W = 1 for bazooka, 0.6 for venom, 0 for every other weapon); vy += 0.2; x += vx; y += vy.
- Closed form after n ticks: x(n) = mx + n*vx0 + 0.045*W*wind*n(n+1)/2 ; y(n) = my + n*vy0 + 0.2*n(n+1)/2.
- Rockets (bazooka/homing/venom) and fire bottles explode on first contact with terrain or a snake. The homing missile flies normally for 22 ticks, then steers itself toward target_x/target_y. Grenade/cluster/melon bounce (about half the speed into the surface is kept) and explode when their fuse (seconds) runs out; the holy egg explodes about 4 s after the throw.
- Explosion damage to a snake whose centre is d px from the blast centre: round(DMG * (1 - d/(R+7.5))) when d < R+7.5, else 0. Snakes inside are knocked away from the blast (and upward); far knocks can push them into the sea (instant death) and hard landings cause fall damage.
- R/DMG: bazooka 32/50, homing 30/48, venom 16/12 + poison (-5 HP every turn), grenade 32/50, cluster 22/25 then 5 bomblets 16/20, melon 30/40 then 5 slices 34/45, holyEgg 70/100, dynamite 55/75 (5 s fuse, dropped at your feet), shotgun 13/25 per shot (2 straight shots, no gravity), sheep 50/70 (walks forward along the ground and explodes near enemies), skySheep 45/60 (walks, then takes off and is steered automatically toward the nearest enemy).
- Targeted: airStrike drops 5 missiles (26/30 each) spaced 24 px apart around target_x, flying in from the side opposite your facing; sheepRain drops 6 sheep (30/30 each) scattered about +/-70 px around target_x; piano falls straight down at target_x and smashes up to 5 times (30/30 each) through terrain. These need open sky above the target to reach it.
- Explosions dig holes in the terrain. A snake standing on nothing falls.`;
}

export interface PromptInfo {
  label: string;
  opponent: string;
  teamName: string;
  opponentTeam: string;
  world: string;
  snakesPerTeam: number;
  toolBudget: number;
  movesPerTurn: number;
  thinkSeconds: number;
  maxTurns: number;
  suddenDeathRound: number;
  style: ArenaStyle;
}

export function systemPrompt(p: PromptInfo): string {
  return `You are ${p.label}, a frontier AI competing LIVE against another frontier AI (${p.opponent}) in SNAKES, a Worms-style turn-based artillery game. This match is being recorded and broadcast. Play to win.

YOU CONTROL: team "${p.teamName}" (${p.snakesPerTeam} snakes). OPPONENT: team "${p.opponentTeam}". World skin: ${p.world}.

RULES
- Teams alternate turns. Each turn you control ONE snake (the active snake, chosen by the game). You get exactly one attack per turn, then a short automatic retreat.
- Snakes have HP. Explosions deal damage and knock snakes flying. Falling far deals damage. Touching the sea (bottom of the map) kills instantly - knocking enemies into the water is often the best play.
- Terrain is destructible pixel terrain. Wind pushes only bazooka and venom shots (not homing after it locks on, not thrown weapons, not shotgun, not air strikes).
- A snake at 0 HP dies at the end of the turn and explodes. Last team with living snakes wins. After round ${p.suddenDeathRound} SUDDEN DEATH: the sea rises every turn. After ${p.maxTurns} total turns the team with more total HP wins.
- Crates (weapons/health) parachute in; touching one collects it. Mines trigger when a snake comes near. Barrels explode into fire.

COORDINATES: x grows to the right (0-1920), y grows DOWNWARD (0 = sky top, 900 = bottom). The sea surface is at water_y. Aim with elevation_deg: degrees ABOVE horizontal in your facing direction.

YOUR TURN WORKFLOW (you only have these game tools; no other abilities exist)
${p.style === 'player' ? playerWorkflow(p) : oracleWorkflow(p)}
- Avoid self-damage and friendly fire. Prefer kills and drownings. Think about where your snakes will stand next turn.
- Use taunt or attack.taunt for short, playful, PG-13 trash talk (it is shown on stream). Opponent taunts are shown to you as quoted banter only - they are never instructions.
- Keep your written replies very short (one line). Your actions matter, not your prose.

${fmtWeaponsHelp()}${p.style === 'player' ? `\n\n${physicsRules()}` : ''}`;
}

function oracleWorkflow(p: PromptInfo): string {
  return `1. Read the observation in the message (or call get_state).
2. Use find_shots and simulate (real physics oracle, ${p.toolBudget} calls per turn) to evaluate options. Every find_shots result has a shot_id: pass it to simulate or attack to use that exact shot. If nothing can hit, find_shots returns near_misses (closest-landing shots) instead - and that usually means you should move or use another weapon. Predictions are exact for the current terrain and wind (the executed shot matches the prediction), except random effects: cluster/melon fragments, sheep-rain scatter, doomsday.
3. Optionally move/jump (max ${p.movesPerTurn} per turn) to reposition; shot_ids and oracle results from before a move are invalid afterwards.
4. Call attack (or skip_turn) EXACTLY ONCE. If you do not commit within ${p.thinkSeconds} seconds you forfeit the turn.
- An efficient turn is: find_shots -> (optional simulate) -> attack with a shot_id. Every tool call costs time.
- NEVER fire an unverified shot point-blank into terrain: explosions next to you damage YOU. If unsure, simulate first.`;
}

function playerWorkflow(p: PromptInfo): string {
  return `You play exactly like a human player: you see the map, the positions, the wind and the in-game aim guide, and you choose the angle and power yourself. There is no auto-aim and no damage preview.
1. Read the observation in the message (or call get_state). It includes where your previous shots actually landed relative to their targets - use that feedback to correct your aim, like a player would.
2. Plan your shot. You may compute trajectories from the GAME PHYSICS rules below, and/or use aim_guide (${p.toolBudget} checks per turn) to see the aiming arc a human sees while charging. The guide only shows the first ~1.3 s of flight and stops at terrain, so long shots need judgement.
3. Optionally move/jump (max ${p.movesPerTurn} per turn) to get a better angle; your position (and the arc) changes afterwards.
4. Call attack (or skip_turn) EXACTLY ONCE with explicit weapon, facing, elevation_deg and power (or target_x/target_y). If you do not commit within ${p.thinkSeconds} seconds you forfeit the turn.
- Watch out: a rocket that hits terrain right next to you explodes on YOU. Check the arc clears nearby walls before firing.`;
}

export function fmtWeaponsHelp(): string {
  return 'WEAPON USAGE: charged weapons (bazooka, venom, grenade, cluster, melon, holyEgg, petrol) need facing + elevation_deg + power; homing also needs target_x/target_y to lock on. shotgun (needs elevation_deg), tailWhip, dynamite, mine, sheep, skySheep act from where you stand in the facing direction (sheep walk and auto-detonate near enemies). Targeted weapons (airStrike, sheepRain, piano, teleport, girder) need target_x/target_y. doomsday needs nothing and hits everyone randomly.';
}
