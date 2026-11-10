export const pinnedFirst = <T extends { pkg?: string }>(groups: T[], isPinned: (pkg: string) => boolean) =>
  groups.toSorted((a, b) => Number(!!b.pkg && isPinned(b.pkg)) - Number(!!a.pkg && isPinned(a.pkg)))
