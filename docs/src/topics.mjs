/** @param {string} label @param {string} ru @param {string} uk @param {string} directory */
const guides = (label, ru, uk, directory) => ({
  label,
  translations: { ru, uk },
  items: [{ autogenerate: { directory: `guides/${directory}` } }],
})

/** @param {string} label @param {string} directory */
const section = (label, directory) => ({ label, items: [{ autogenerate: { directory } }] })

export const topics = [
  {
    label: { en: "Documentation", ru: "Документация", uk: "Документація" },
    link: "/start/introduction/",
    icon: "open-book",
    items: [
      section("Start here", "start"),
      section("Concepts", "concepts"),
      {
        label: "Session tools",
        translations: { ru: "Инструменты сессии", uk: "Інструменти сесії" },
        items: [{ autogenerate: { directory: "session-tools" } }],
      },
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
    icon: "rocket",
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

export const externalLinks = [{ label: "GitHub", href: "https://github.com/holtdroid" }]

/** @param {string} link @param {string | undefined} locale */
export const localized = (link, locale) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${locale ? `/${locale}` : ""}${link}`
