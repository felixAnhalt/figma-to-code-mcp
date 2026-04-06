export const MIN_USES_FOR_TOKEN = 2;

export const COLOR_SEMANTIC_NAMES: Record<string, string> = {
  "rgba(255, 255, 255, 1)": "white",
  "rgba(151, 71, 255, 1)": "primary",
  "rgba(48, 52, 63, 1)": "surfaceDark",
  "rgba(22, 25, 34, 1)": "textPrimary",
  "rgba(106, 110, 121, 1)": "textSecondary",
  "rgba(250, 250, 255, 1)": "surfaceLight",
  "rgba(74, 78, 89, 1)": "textMuted",
  "rgba(236, 238, 247, 1)": "borderLight",
  "rgba(64, 74, 136, 1)": "primaryDark",
  "rgba(185, 28, 28, 1)": "destructive",
  "rgba(0, 0, 0, 1)": "black",
  "rgba(0, 0, 0, 0)": "transparent",
};

export const SHADOW_SEMANTIC_NAMES: Record<string, string> = {
  "0px 1px 2px 0px rgba(0,0,0,0.05)": "sm",
  "0px 1px 2px -1px rgba(0,0,0,0.1), 0px 1px 3px 0px rgba(0,0,0,0.1)": "md",
  "0px 0px 0px 3px rgba(6,182,212,1)": "focusRing",
  "0px 0px 0px 3px rgba(239,68,68,1)": "focusRingDestructive",
};

export const SPACING_SEMANTIC_NAMES: Record<number, string> = {
  2: "xs",
  4: "sm",
  6: "md",
  8: "lg",
  10: "xl",
  12: "2xl",
  16: "3xl",
  20: "4xl",
  24: "5xl",
  32: "6xl",
  48: "7xl",
  64: "8xl",
};

export const RADIUS_SEMANTIC_NAMES: Record<number, string> = {
  2: "xs",
  4: "sm",
  8: "md",
  16: "lg",
  9999: "full",
};

export const PADDING_COMBO_SEMANTIC_NAMES: Record<string, string> = {
  "8,16": "buttonMd",
  "5.5,12": "buttonSm",
  "10,24": "buttonLg",
  "3,8": "buttonXs",
};

export const HEIGHT_SEMANTIC_NAMES: Record<number, string> = {
  24: "xs",
  32: "sm",
  36: "md",
  40: "lg",
};
