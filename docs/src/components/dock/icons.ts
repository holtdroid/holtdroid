const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const icons = {
  home: ["M4 11l8-7 8 7v9H4z", "M10 20v-6h4v6"],
  book: ["M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z", "M4 19V5"],
  guide: [circle(12, 12, 9), "M8 12l3 3 5-6"],
  puzzle: ["M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3z"],
  search: [circle(11, 11, 7), "M20 20l-3.5-3.5"],
  sun: [circle(12, 12, 4), "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"],
  moon: ["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"],
  git: [circle(6, 5, 2), circle(6, 19, 2), circle(18, 7, 2), "M6 7v10M18 9c0 4-4 5-10 8"],
  play: ["M7 5l12 7-12 7z"],
  pages: ["M4 6h16M4 12h16M4 18h10"],
  close: ["M6 6l12 12M18 6L6 18"],
  arrow: ["M5 12h14M13 6l6 6-6 6"],
  right: ["M9 6l6 6-6 6"],
  down: ["M6 9l6 6 6-6"],
  copy: ["M8 8h12v12H8z", "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"],
  external: ["M7 17L17 7M8 7h9v9"],
  message: ["M4 5h16v11H9l-5 4z"],
  bucket: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6l1.5 13c.2 1.2 3 2 6.5 2s6.3-.8 6.5-2L20 6"],
  upload: ["M12 16V4M7 9l5-5 5 5M4 20h16"],
  chrome: [circle(12, 12, 9), circle(12, 12, 3.5), "M12 8.5h8.2M9 13.8 4.9 6.7M15 13.8l-4.1 7.1"],
} satisfies Record<string, string[]>

export type IconName = keyof typeof icons
