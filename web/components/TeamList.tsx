import Avatar from "./Avatar";
import type { TeamMember } from "@/lib/team";

/**
 * The org's roster, on Settings.
 *
 * Who is in an org is a fact about tracker tokens (see lib/org.ts), so it used to
 * be invisible: a head count on the team defaults card, and whoever made the
 * podium. This lists everyone the podium ranks, in an order that holds still.
 */
/** "Acme on Linear · 3 people": the Team section's status line. */
export function teamSummary(orgName: string, providerName: string, count: number): string {
  return `${orgName} on ${providerName} · ${count === 1 ? "just you so far" : `${count} people`}`;
}

export default function TeamList({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return null;

  return (
    <div>
      <ul className="card thin-scroll max-h-[26rem] overflow-y-auto py-1">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex h-11 items-center gap-2.5 px-3.5"
          >
            <Avatar name={member.fullName} imageUrl={member.imageUrl} size={24} />
            {/* The name holds its width and the title gives way first: on a
                phone the two shrank together and cut every name in half. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="max-w-full shrink-0 truncate text-sm text-ink">
                {member.fullName}
                {member.isYou && <span className="ml-1.5 text-xs text-muted">you</span>}
              </span>
              {member.title && (
                <span className="min-w-0 truncate text-[13px] text-muted">
                  {member.title}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-muted">
              {member.filed} {member.filed === 1 ? "ticket" : "tickets"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
