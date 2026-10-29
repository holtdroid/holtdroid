import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-device",
      action: "look",
      text: {
        en: "Found a bug? The Device card at the bottom of the column builds a bug report in one click.",
        ru: "Нашли баг? Карточка Device внизу колонки собирает баг-репорт в один клик.",
        uk: "Знайшли баг? Картка Device унизу колонки збирає баг-репорт в один клік.",
      },
    },
    {
      target: "w-device",
      action: "hover",
      set: { panel: "device" },
      text: {
        en: "Hover it: you see the model, Android version and build, the things a developer asks first.",
        ru: "Наведите на неё курсор: видны модель, версия Android и сборка — то, о чём разработчик спрашивает первым делом.",
        uk: "Наведіть на неї курсор: видно модель, версію Android і збірку — те, про що розробник питає насамперед.",
      },
    },
    {
      target: "bugreport-bundle",
      set: { bundling: 45 },
      text: {
        en: "Press Bundle. Holtdroid takes a screenshot and collects the logcat, the device and the app details.",
        ru: "Нажмите Bundle. Holtdroid делает скриншот и собирает logcat, данные об устройстве и о приложении.",
        uk: "Натисніть Bundle. Holtdroid робить скриншот і збирає logcat, дані про пристрій і застосунок.",
      },
    },
    {
      target: "bugreport-bundle",
      action: "look",
      set: { bundling: 100, toast: "bundle" },
      text: {
        en: "A few seconds later the zip is downloaded to your computer.",
        ru: "Через несколько секунд zip-архив скачается на ваш компьютер.",
        uk: "За кілька секунд zip-архів завантажиться на ваш комп'ютер.",
      },
    },
    {
      target: "toast",
      action: "look",
      text: {
        en: "Attach the zip to the ticket. Nobody has to ask which phone, which Android or which build it was.",
        ru: "Приложите архив к задаче. Никому не придётся спрашивать, какой был телефон, Android или сборка.",
        uk: "Додайте архів до задачі. Нікому не доведеться питати, який був телефон, Android чи збірка.",
      },
    },
    {
      target: "share",
      set: { panel: "none", toast: "link" },
      text: {
        en: "Want someone to see the bug live? Share copies a link to this session.",
        ru: "Хотите, чтобы кто-то посмотрел баг вживую? Share копирует ссылку на эту сессию.",
        uk: "Хочете, щоб хтось подивився баг наживо? Share копіює посилання на цю сесію.",
      },
    },
    {
      target: "toast",
      action: "look",
      text: {
        en: "Anyone signed in to the portal opens the same device with it, while the session runs.",
        ru: "По ней любой, кто вошёл в портал, откроет то же самое устройство, пока сессия работает.",
        uk: "За ним будь-хто, хто увійшов у портал, відкриє той самий пристрій, поки сесія працює.",
      },
    },
  ],
} satisfies Scenario
