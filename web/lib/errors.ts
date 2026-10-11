/** The message of anything thrown: an Error's, else its string form. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String((e as { message?: unknown } | null)?.message ?? e);
}
