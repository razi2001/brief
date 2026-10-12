import type { SceneKey } from "@/lib/guide/lessons";
import type { SceneDef } from "./types";
import { connect, install } from "./start";
import { create, editticket, record } from "./first";
import { briefit, replay, rules } from "./more";

/** Every lesson's illustration, by the lesson's `scene` key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCENES: Record<SceneKey, SceneDef<any>> = {
  install,
  connect,
  record,
  create,
  editticket,
  replay,
  briefit,
  rules,
};
