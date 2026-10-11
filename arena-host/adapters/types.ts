import type { Activity, PlayerSpec, ToolExec, TurnResult } from '../../src/arena/link.ts';
import type { ToolSchema } from '../../src/arena/schema.ts';

export type ActivitySink = (a: Omit<Activity, 'team'>) => void;

/** One live player. Implementations: Copilot SDK (real models), mocks (free, for testing). Gemini/Grok CLIs plug in here later. */
export interface Adapter {
  start(player: PlayerSpec, tools: ToolSchema[]): Promise<void>;
  turn(prompt: string, exec: ToolExec, timeoutMs: number, onActivity: ActivitySink): Promise<TurnResult>;
  /** Stops an in-flight turn early. */
  abort(): Promise<void>;
  stop(): Promise<void>;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
