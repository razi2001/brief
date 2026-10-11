/**
 * Local Clerk `appearance.elements` that make Clerk's own card BE the white
 * sheet on the sky: hairline border, 14px radius, the `.panel` shadow, small
 * Linear-sized type. Shared by the sign-in, sign-up and account pages.
 */
const SHADOW = "0 1px 2px rgba(26, 22, 18, 0.04), 0 12px 40px -18px rgba(26, 22, 18, 0.18)";
const HAIRLINE = "1px solid rgba(26, 22, 18, 0.09)";

export const clerkAuthSheet = {
  elements: {
    rootBox: { width: "100%", maxWidth: "400px" },
    cardBox: {
      width: "100%",
      maxWidth: "100%",
      borderRadius: "14px",
      border: HAIRLINE,
      boxShadow: SHADOW,
      overflow: "hidden",
    },
    card: {
      background: "#fffdfa",
      boxShadow: "none",
      border: "none",
      borderRadius: 0,
      width: "100%",
      padding: "28px 28px 24px",
      gap: "22px",
    },
    headerTitle: { fontSize: "15px", fontWeight: 600, color: "#1a1612" },
    headerSubtitle: { fontSize: "13px", color: "#8a8378" },
    socialButtonsBlockButton: {
      border: HAIRLINE,
      boxShadow: "0 1px 2px rgba(26, 22, 18, 0.04)",
      background: "#fffdfa",
      fontSize: "13px",
    },
    dividerLine: { background: "rgba(26, 22, 18, 0.09)" },
    dividerText: { fontSize: "12px", color: "#8a8378" },
    formFieldLabel: { fontSize: "13px", fontWeight: 500, color: "#3a3530" },
    formFieldInput: { fontSize: "13px" },
    formButtonPrimary: {
      fontSize: "13px",
      fontWeight: 500,
      background: "#dd6936",
      boxShadow: "0 1px 2px rgba(221, 105, 54, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18)",
      border: "1px solid transparent",
      "&:hover": { background: "#d0602f" },
    },
    footer: {
      background: "#f7f4ee",
      borderTop: HAIRLINE,
    },
    footerActionText: { fontSize: "13px", color: "#8a8378" },
    footerActionLink: { fontSize: "13px", fontWeight: 500 },
  },
};

export const clerkProfileSheet = {
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      maxWidth: "100%",
      borderRadius: "14px",
      border: HAIRLINE,
      boxShadow: SHADOW,
      overflow: "hidden",
    },
    navbar: {
      background: "#f7f4ee",
      borderRight: HAIRLINE,
    },
    scrollBox: {
      background: "#fffdfa",
      borderRadius: 0,
      boxShadow: "none",
      border: "none",
    },
    headerTitle: { fontSize: "15px", fontWeight: 600, color: "#1a1612" },
    profileSectionTitleText: { fontSize: "13px", fontWeight: 500, color: "#3a3530" },
    footer: { background: "#f7f4ee" },
  },
};
