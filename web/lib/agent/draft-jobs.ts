/**
 * Drafts being written right now, in this server process - so a draft is
 * written once, whoever starts it.
 *
 * Two things start a draft's write: the /draft route itself (in the
 * background, the moment the extension hands the brief over - nobody has to
 * open the page), and the brief page's live stream (when the owner opens it
 * while it's still writing). Whichever comes second waits for the first
 * instead of paying for a second model run.
 *
 * In-memory: the app runs as one always-on machine (fly.toml). With several,
 * the worst case is a second write of the same draft, not a lost one.
 */
const jobs = new Map<string, Promise<unknown>>();

/** Run `write` for this brief unless a write is already running; either way, the running one. */
export function runDraftJob(briefId: string, write: () => Promise<unknown>): Promise<unknown> {
  const running = jobs.get(briefId);
  if (running) return running;
  const job = Promise.resolve()
    .then(write)
    .catch(() => {})
    .finally(() => jobs.delete(briefId));
  jobs.set(briefId, job);
  return job;
}

/** The write running for this brief, if any. */
export function draftJob(briefId: string): Promise<unknown> | undefined {
  return jobs.get(briefId);
}

/**
 * Mark a write that runs inline (the live stream) as running, so a background
 * write doesn't start alongside it. Call the returned function when it's done.
 */
export function holdDraftJob(briefId: string): () => void {
  let done!: () => void;
  const job = new Promise<void>((r) => { done = r; }).finally(() => jobs.delete(briefId));
  jobs.set(briefId, job);
  return () => done();
}
