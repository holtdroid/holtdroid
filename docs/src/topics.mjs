/** @param {string} label @param {string} ru @param {string} uk @param {string} directory */
const guides = (label, ru, uk, directory) => ({
  label,
  translations: { ru, uk },
  collapsed: true,
  items: [{ autogenerate: { directory: `guides/${directory}` } }],
})

/** @param {string} label @param {string} directory @param {Record<string, string>} [translations] */
const section = (label, directory, translations) => ({
  label,
  translations,
  collapsed: true,
  items: [{ autogenerate: { directory } }],
})

export const topics = [
  {
    label: { en: "Documentation", ru: "Документация", uk: "Документація" },
    link: "/start/introduction/",
    icon: "open-book",
    groupIcons: ["rocket", "information", "laptop", "setting", "cloud-download", "mobile-android", "server", "puzzle"],
    items: [
      section("Start here", "start"),
      section("Concepts", "concepts"),
      section("Session tools", "session-tools", { ru: "Инструменты сессии", uk: "Інструменти сесії" }),
      section("Configuration", "configuration"),
      section("APK sources", "sources"),
      section("Tools", "tools"),
      section("Operations", "operations"),
      section("Extending", "extending"),
    ],
  },
  {
    label: { en: "Guides", ru: "Гайды", uk: "Посібники" },
    link: "/guides/first-steps/launch-app/",
    icon: "approve-check-circle",
    groupIcons: ["rocket", "chrome", "signal", "mobile-android", "pencil", "notes", "code-branch"],
    items: [
      guides("First steps", "Первые шаги", "Перші кроки", "first-steps"),
      guides("Debugging web content", "Отладка веба", "Налагодження вебу", "web"),
      guides("Real-world conditions", "Условия реального мира", "Реальні умови", "conditions"),
      guides("Working with the app", "Работа с приложением", "Робота із застосунком", "app"),
      guides("Design", "Дизайн", "Дизайн", "design"),
      guides("Recordings and bug reports", "Записи и баг-репорты", "Записи та баг-репорти", "recordings"),
      guides("For developers", "Для разработчиков", "Для розробників", "developers"),
    ],
  },
]

/** @param {string} link @param {string} [locale] */
export const localized = (link, locale) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${locale ? `/${locale}` : ""}${link}`

/** @type {{ label: string, href: string, icon: "github" | "puzzle" }[]} */
export const externalLinks = [
  { label: "GitHub", href: "https://github.com/holtdroid", icon: "github" },
  { label: "Repositories", href: localized("/#repositories"), icon: "puzzle" },
]
