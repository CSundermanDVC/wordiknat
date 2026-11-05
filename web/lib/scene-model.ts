import type { ForecastPoint } from "../../src/core/types.ts";
import { answerState, type AnswerState, type heroView } from "./answer-state.ts";

export type SceneKey = AnswerState | "neutral";
export type Pose = "wave" | "point-up" | "umbrella" | "closed-umbrella" | "head-scratch";
export type Spot = "high-right" | "corner" | "mid" | "over-rider" | "left" | "left-soon";
export type Actor =
  | { kind: "sun"; spot: Spot; small: boolean }
  | { kind: "puffs"; spot: Spot; count: 1 | 2 }
  | { kind: "grump"; spot: Spot; mood: "angry" | "calm"; drops: number };

export type Scene = { key: SceneKey; pose: Pose; actors: Actor[] };

const SCENES: Record<SceneKey, Scene> = {
  dry: {
    key: "dry",
    pose: "wave",
    actors: [{ kind: "sun", spot: "high-right", small: false }, { kind: "puffs", spot: "left", count: 2 }],
  },
  soon: {
    key: "soon",
    pose: "point-up",
    actors: [{ kind: "grump", spot: "high-right", mood: "angry", drops: 0 }, { kind: "puffs", spot: "left-soon", count: 1 }],
  },
  now: { key: "now", pose: "umbrella", actors: [{ kind: "grump", spot: "over-rider", mood: "angry", drops: 7 }] },
  drying: {
    key: "drying",
    pose: "closed-umbrella",
    actors: [{ kind: "sun", spot: "corner", small: true }, { kind: "grump", spot: "mid", mood: "calm", drops: 3 }],
  },
  neutral: { key: "neutral", pose: "head-scratch", actors: [{ kind: "puffs", spot: "left", count: 2 }] },
};

export const sceneFor = (key: SceneKey): Scene => SCENES[key];

export const sceneKeyOf = (view: ReturnType<typeof heroView>): SceneKey =>
  view.mode === "state" ? view.view.state : "neutral";

/** The scene the street would show if "now" were the given step; null for a bad index or no steps left. */
export function sceneAtStep(points: readonly ForecastPoint[], index: number, now: Date): SceneKey | null {
  const p = points[index];
  if (!p) return null;
  return answerState(points, p.time > now ? p.time : now)?.state ?? null;
}
