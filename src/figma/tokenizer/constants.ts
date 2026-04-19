export const MIN_USES_FOR_TOKEN = 2;

export const COLOR_SEMANTIC_NAMES: Record<string, string> = {
  "#FFFFFF": "white",
  "#9747FF": "primary",
  "#30343F": "surfaceDark",
  "#161922": "textPrimary",
  "#6A6E79": "textSecondary",
  "#FAFAFA": "surfaceLight",
  "#4A4E59": "textMuted",
  "#ECEEF7": "borderLight",
  "#404A88": "primaryDark",
  "#B91C1C": "destructive",
  "#000000": "black",
  "#00000000": "transparent",
};

export const SHADOW_SEMANTIC_NAMES: Record<string, string> = {
  "0px 1px 2px 0px #0000000D": "sm",
  "0px 1px 2px -1px #0000001A, 0px 1px 3px 0px #0000001A": "md",
  "0px 0px 0px 3px #06B6D4": "focusRing",
  "0px 0px 0px 3px #EF4444": "focusRingDestructive",
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
