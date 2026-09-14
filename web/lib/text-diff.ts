/**
 * Line-level diff, used by the "change the team defaults" confirmation so the
 * dialog can show exactly what is about to change for everyone else rather
 * than asking "are you sure?" about an invisible edit.
 *
 * A plain LCS over lines: small inputs (guidance is capped at 4000 chars), no
 * dependency, and it keeps unchanged lines as context instead of rewriting the
 * whole block whenever one line moves.
 */

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

/** Split into lines, tolerating CRLF so a line-ending change alone is not a diff. */
function lines(text: string): string[] {
  const normalized = (text ?? "").replace(/\r\n/g, "\n");
  return normalized === "" ? [] : normalized.split("\n");
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      // Ties favour the removal, so a replaced line reads as "- old" then
      // "+ new" rather than the other way round.
      out.push({ kind: "remove", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: "remove", text: a[i++] });
  while (j < n) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Whether anything actually changed - lets the dialog skip a no-op save. */
export function hasChanges(d: DiffLine[]): boolean {
  return d.some((l) => l.kind !== "same");
}
