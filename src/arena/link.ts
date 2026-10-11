// Transport-neutral link between the game (which owns the world) and whatever runs the models.

export interface Usage {
  /** Model API calls made this turn/match. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Premium-request cost units reported by the runtime (model multiplier applied). */
  cost: number;
  /** AI credit units reported by the runtime (nano AIU). */
  nanoAiu: number;
}

export function emptyUsage(): Usage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, nanoAiu: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cost: a.cost + b.cost,
    nanoAiu: a.nanoAiu + b.nanoAiu,
  };
}

export type ToolExec = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface TurnResult {
  ok: boolean;
  error?: string;
  /** Final visible text the model wrote this turn. */
  text?: string;
  usage: Usage;
  ms: number;
  timedOut?: boolean;
}

/** Live side-channel from the model runtime: text, reasoning summaries, usage, status. */
export interface Activity {
  team: 0 | 1;
  kind: 'message' | 'reasoning' | 'intent' | 'usage' | 'status' | 'error';
  text: string;
  usage?: Usage;
}

export interface PlayerSpec {
  provider: string;
  model: string;
  label: string;
  effort?: string;
  system: string;
}

export interface MatchInfo {
  matchId: string;
  players: [PlayerSpec, PlayerSpec];
  meta: Record<string, unknown>;
}

export interface ModelChoice {
  provider: string;
  id: string;
  label: string;
  note?: string;
}

export interface ClankerLink {
  startMatch(info: MatchInfo): Promise<void>;
  playTurn(team: 0 | 1, prompt: string, exec: ToolExec, timeoutMs: number): Promise<TurnResult>;
  /** Stores a structured log entry with the match record. */
  log(entry: Record<string, unknown>): void;
  endMatch(summary: Record<string, unknown>): Promise<{ dir?: string }>;
  /** Stops a model mid-turn (its turn already ended in the game), so it stops spending credits. */
  abort(team: 0 | 1): void;
  onActivity: ((a: Activity) => void) | null;
}
