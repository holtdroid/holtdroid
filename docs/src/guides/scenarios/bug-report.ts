import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, deviceTab: "app" },
  steps: [
    {
      target: "w-device",
      action: "look",
      text: {
        en: "Found a bug? The Device row on the App tab of the Device panel builds a bug report in one click.",
        ru: "Нашли баг? Строка Device на вкладке App панели Device собирает баг-репорт в один клик.",
        uk: "Знайшли баг? Рядок Device на вкладці App панелі Device збирає баг-репорт в один клік.",
      },
    },
    {
      target: "w-device",
      action: "click",
      set: { panel: "device" },
      text: {
        en: "Open it: you see the model, Android version and build, the things a developer asks first.",
        ru: "Раскройте её: видны модель, версия Android и сборка — то, о чём разработчик спрашивает первым делом.",
        uk: "Розгорніть його: видно модель, версію Android і збірку — те, про що розробник питає насамперед.",
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
  ],
} satisfies Scenario
