import Avatar from "./Avatar";
import type { TeamMember } from "@/lib/team";

/**
 * The org's roster, on Settings.
 *
 * Who is in an org is a fact about tracker tokens (see lib/org.ts), so it used to
 * be invisible: a head count on the team defaults card, and whoever made the
 * podium. This lists everyone the podium ranks, in an order that holds still.
 */
export default function TeamList({
  members,
  orgName,
  providerName,
}: {
  members: TeamMember[];
  orgName: string;
  providerName: string;
}) {
  if (members.length === 0) return null;

  return (
    <section id="team" className="scroll-mt-8">
      <h2 className="font-display text-2xl text-ink">Team</h2>
      <p className="mt-1 text-xs text-muted">
        {orgName} on {providerName} ·{" "}
        {members.length === 1 ? "just you so far" : `${members.length} people`}
      </p>

      <ul className="card thin-scroll mt-4 max-h-[26rem] overflow-y-auto px-4 py-1">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex items-center gap-3 border-b hairline py-2.5 last:border-b-0"
          >
            <Avatar name={member.fullName} imageUrl={member.imageUrl} size={30} />
            {/* The name holds its width and the title gives way first: on a
                phone the two shrank together and cut every name in half. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="max-w-full shrink-0 truncate text-sm text-ink">
                {member.fullName}
                {member.isYou && <span className="ml-1 text-[0.6875rem] text-accent">you</span>}
              </span>
              {member.title && (
                <span className="min-w-0 truncate text-[0.6875rem] italic text-muted">
                  {member.title}
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {member.filed} {member.filed === 1 ? "ticket" : "tickets"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
