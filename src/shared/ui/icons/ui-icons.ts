/** The interface's own stroke icons (24 × 24), from the approved canvas. */
export const UI_ICONS = {
  back: "m15 5-7 7 7 7",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7.5",
  search: "M17.5 11a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-1.5 5 4 4",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  home: "M4 10.5 12 4l8 6.5V20H4v-9.5Z",
  list: "M4 6h16M4 12h16M4 18h10",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  signOut: "M9 4H5v16h4M15 8l4 4-4 4M19 12H9.5",
  lock: "M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6v-9Z",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4.5v5.5m0 3.5h.01",
  calendar: "M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4",
} as const;
export type UiIconName = keyof typeof UI_ICONS;
