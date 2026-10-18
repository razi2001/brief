// Small line icons for the Guide's mockups (copies of the extension's own).
const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconPlus = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
export const IconShot = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="m21 17-5-5-4 4-2-2-4 4" />
  </svg>
);
export const IconVideo = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="m10 8 6 4-6 4z" />
    <rect x="3" y="4" width="18" height="16" rx="3" />
  </svg>
);
export const IconReplay = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </svg>
);
export const IconUpload = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);
export const IconPuzzle = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z" />
  </svg>
);
export const IconPin = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M9 4h6l-1 6 3 3H7l3-3z" />
    <path d="M12 16v5" />
  </svg>
);
export const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
  </svg>
);
export const IconFlag = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </svg>
);
export const IconCheck = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6.2 5 8.5l4.5-5" />
  </svg>
);
export const IconPen = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M4 20l4-1 10-10-3-3L5 16z" />
  </svg>
);
export const IconCursor = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3 2l13 7.2-5.6 1.4L7.6 16z" fill="#1a1612" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
export const IconReset = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);
export const IconCloud = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.6A3.5 3.5 0 0 1 18 18Z" />
  </svg>
);
export const IconMic = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M12 1.5a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0v-7a3 3 0 0 0-3-3z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <path d="M12 18v4" />
  </svg>
);
export const IconX = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
export const IconChevron = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const IconGrip = () => (
  <svg viewBox="0 0 10 16" fill="currentColor">
    <circle cx="2" cy="3" r="1.2" />
    <circle cx="8" cy="3" r="1.2" />
    <circle cx="2" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="2" cy="13" r="1.2" />
    <circle cx="8" cy="13" r="1.2" />
  </svg>
);
export const IconCrop = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </svg>
);
export const IconSound = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </svg>
);
export const IconTrash = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />
  </svg>
);
export const IconPencil = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.8}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const IconExternal = () => (
  <svg viewBox="0 0 16 16" {...line} strokeWidth={1.6}>
    <path d="M5 11 11 5M6 5h5v5" />
  </svg>
);
export const IconShare = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.7}>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
  </svg>
);
export const IconMarkdown = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.7}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 15V9l2.5 3L12 9v6M16 9v6m-2-2 2 2 2-2" />
  </svg>
);
export const IconRefresh = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={1.9}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);
export const IconBack = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
export const IconForward = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconSend = () => (
  <svg viewBox="0 0 24 24" {...line} strokeWidth={2}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
export const IconLink = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
export const IconTerminal = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </svg>
);
export const IconPlane = () => (
  <svg viewBox="0 0 24 24" {...line}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </svg>
);
