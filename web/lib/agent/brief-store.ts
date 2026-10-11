import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a brief's files are read from: the `briefs` bucket in production, a
 * folder for the ticket eval (scripts/ticket-eval). Paths are storage paths,
 * e.g. "<prefix>/brief.json" or "<prefix>/screenshots".
 */
export interface BriefStore {
  /** The file's bytes, or null when it isn't there. */
  download(path: string): Promise<Buffer | null>;
  /** Names of what sits directly in `dir` (no recursion). */
  list(dir: string): Promise<string[]>;
}

export function supabaseStore(admin: SupabaseClient): BriefStore {
  const bucket = () => admin.storage.from("briefs");
  return {
    async download(path) {
      const { data } = await bucket().download(path);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    },
    async list(dir) {
      const { data } = await bucket().list(dir, { limit: 200 });
      return (data ?? []).map((o) => o.name);
    },
  };
}
