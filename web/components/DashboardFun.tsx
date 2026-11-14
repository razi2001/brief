/** Plain sign-up: teammates on the same tracker workspace join your board by themselves. */
const inviteLink = () => `${window.location.origin}/sign-up`;

/** Copies the invite link; false when the clipboard is blocked. */
export async function copyInviteLink(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(inviteLink());
    return true;
  } catch {
    return false;
  }
}
