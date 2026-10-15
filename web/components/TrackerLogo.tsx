import type { ProviderKey } from "./provider-labels";

// Official tracker logomarks (paths from simple-icons), in brand colors.
// Azure DevOps has no simple-icons entry and Monday's mark is drawn here.
export function LinearLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#5E6AD2"
        d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"
      />
    </svg>
  );
}

export function JiraLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#2684FF"
        d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z"
      />
    </svg>
  );
}

export function GithubLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#181717"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

export function GitlabLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#FC6D26"
        d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"
      />
    </svg>
  );
}

export function AzureDevopsLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#0078D7"
        d="M0 8.877L2.247 5.91l8.405-3.416V.022l7.37 5.393L2.966 8.338v8.225L0 15.707zm24-4.44v14.32l-5.735 4.7-9.261-3.037V24l-6.038-7.441 15.036 1.787V5.435z"
      />
    </svg>
  );
}

export function ClickUpLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#7B68EE"
        d="M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405c-2.701 3.66-6.058 5.594-9.947 5.594-3.877 0-7.248-1.921-10.053-5.56zM12.036 5.954l-6.566 5.657-3.017-3.501L12.05 0l9.552 8.126-3.03 3.487z"
      />
    </svg>
  );
}

export function NotionLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#000000"
        d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.053-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.263c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.083.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.727l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.446-1.632z"
      />
    </svg>
  );
}

export function TrelloLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#0052CC"
        d="M21.147 0H2.853A2.853 2.853 0 0 0 0 2.853v18.294A2.853 2.853 0 0 0 2.853 24h18.294A2.853 2.853 0 0 0 24 21.147V2.853A2.853 2.853 0 0 0 21.147 0zM10.34 17.287a.953.953 0 0 1-.953.953h-4.28a.954.954 0 0 1-.954-.953V4.906a.954.954 0 0 1 .954-.953h4.28a.954.954 0 0 1 .953.953zm9.5-5.75a.953.953 0 0 1-.951.953h-4.281a.955.955 0 0 1-.955-.953V4.906a.953.953 0 0 1 .955-.953h4.28a.952.952 0 0 1 .952.953z"
      />
    </svg>
  );
}

export function AsanaLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <path
        fill="#F06A6A"
        d="M18.78 12.653c-2.882 0-5.22 2.336-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.34 5.22-5.22-2.336-5.22-5.22-5.22zm-13.56 0c-2.88 0-5.22 2.337-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.338 5.22-5.22-2.336-5.22-5.22-5.22zm12-6.525c0 2.883-2.337 5.22-5.22 5.22-2.882 0-5.22-2.337-5.22-5.22 0-2.88 2.338-5.22 5.22-5.22 2.883 0 5.22 2.34 5.22 5.22z"
      />
    </svg>
  );
}

/** monday.com's mark: two slanted capsules and a dot. */
export function MondayLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" role="img">
      <g fill="none" strokeWidth="4.6" strokeLinecap="round">
        <path stroke="#FF3D57" d="M4 16.5 8.5 7.5" />
        <path stroke="#FFCB00" d="M11 16.5 15.5 7.5" />
      </g>
      <circle fill="#00D647" cx="20.5" cy="16.2" r="2.6" />
    </svg>
  );
}

const KEYS: ProviderKey[] = [
  "linear",
  "jira",
  "github",
  "gitlab",
  "azure",
  "clickup",
  "notion",
  "trello",
  "asana",
  "monday",
];

/**
 * Anything that merely contains a provider, in the order checked: a Clerk
 * provider string ("oauth_atlassian"), a display name ("azure devops").
 */
const NEEDLES: Array<[string, ProviderKey]> = [
  ["jira", "jira"],
  ["atlassian", "jira"],
  ["github", "github"],
  ["gitlab", "gitlab"],
  ["azure", "azure"],
  ["devops", "azure"],
  ["clickup", "clickup"],
  ["notion", "notion"],
  ["trello", "trello"],
  ["asana", "asana"],
  ["monday", "monday"],
];

function keyFor(kind: string): ProviderKey {
  const k = (kind || "").toLowerCase();
  const exact = KEYS.find((key) => key === k);
  if (exact) return exact;
  return NEEDLES.find(([needle]) => k.includes(needle))?.[1] ?? "linear";
}

/** Look up a logomark by provider key (or anything containing it). */
export function TrackerLogo({ kind, size = 22 }: { kind: string; size?: number }) {
  switch (keyFor(kind)) {
    case "jira":
      return <JiraLogo size={size} />;
    case "github":
      return <GithubLogo size={size} />;
    case "gitlab":
      return <GitlabLogo size={size} />;
    case "azure":
      return <AzureDevopsLogo size={size} />;
    case "clickup":
      return <ClickUpLogo size={size} />;
    case "notion":
      return <NotionLogo size={size} />;
    case "trello":
      return <TrelloLogo size={size} />;
    case "asana":
      return <AsanaLogo size={size} />;
    case "monday":
      return <MondayLogo size={size} />;
    case "linear":
      return <LinearLogo size={size} />;
  }
}
