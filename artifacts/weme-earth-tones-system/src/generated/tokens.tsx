/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#ffffff",
      "foreground": "#5c5154",
      "border": "#b5b0b1",
      "card": "#ffffff",
      "cardForeground": "#5c5154",
      "popover": "#ffffff",
      "popoverForeground": "#5c5154",
      "primary": "#92946e",
      "primaryForeground": "#ffffff",
      "secondary": "#9d202f",
      "secondaryForeground": "#ffffff",
      "muted": "#b5b0b1",
      "mutedForeground": "#5c5154",
      "accent": "#f6c367",
      "accentForeground": "#5c5154",
      "destructive": "#9d202f",
      "destructiveForeground": "#ffffff",
      "input": "#b5b0b1",
      "ring": "#92946e",
      "chart1": "#92946e",
      "chart2": "#9d202f",
      "chart3": "#f6c367",
      "chart4": "#cb7a51",
      "chart5": "#c9ad6b",
      "sidebar": "#ffffff",
      "sidebarForeground": "#5c5154",
      "sidebarBorder": "#b5b0b1",
      "sidebarPrimary": "#92946e",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#cbcfbb",
      "sidebarAccentForeground": "#5c5154",
      "sidebarRing": "#92946e"
    },
    "dark": {
      "background": "#5c5154",
      "foreground": "#cbcfbb",
      "border": "#767661",
      "card": "#767661",
      "cardForeground": "#ffffff",
      "popover": "#5c5154",
      "popoverForeground": "#cbcfbb",
      "primary": "#92946e",
      "primaryForeground": "#ffffff",
      "secondary": "#af6e77",
      "secondaryForeground": "#5c5154",
      "muted": "#767661",
      "mutedForeground": "#cbcfbb",
      "accent": "#c9ad6b",
      "accentForeground": "#5c5154",
      "destructive": "#9d202f",
      "destructiveForeground": "#ffffff",
      "input": "#767661",
      "ring": "#f6c367",
      "chart1": "#92946e",
      "chart2": "#af6e77",
      "chart3": "#f6c367",
      "chart4": "#cb7a51",
      "chart5": "#d799a1",
      "sidebar": "#5c5154",
      "sidebarForeground": "#cbcfbb",
      "sidebarBorder": "#767661",
      "sidebarPrimary": "#f6c367",
      "sidebarPrimaryForeground": "#5c5154",
      "sidebarAccent": "#767661",
      "sidebarAccentForeground": "#cbcfbb",
      "sidebarRing": "#f6c367"
    }
  },
  "fontFamily": {
    "sans": [
      "Nunito",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.5rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
