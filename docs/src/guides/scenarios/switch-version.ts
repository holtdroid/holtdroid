import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "version-switcher",
      set: { panel: "versions" },
      text: {
        en: "Click the app's name and icon in the session header. It opens Switch version.",
        ru: "Нажмите на название и иконку приложения в шапке сессии. Откроется Switch version.",
        uk: "Натисніть на назву й іконку застосунку в шапці сесії. Відкриється Switch version.",
      },
    },
    {
      target: "build-2.5.0-rc1",
      action: "look",
      text: {
        en: "Every build with the same application ID is listed, from every source, with its branch, uploader and age.",
        ru: "Здесь все сборки с тем же application ID из всех источников, с веткой, автором и временем загрузки.",
        uk: "Тут усі збірки з тим самим application ID з усіх джерел, з гілкою, автором і часом завантаження.",
      },
    },
    {
      target: "keep-data",
      action: "look",
      text: {
        en: "Keep app data is on by default: the build is installed over the current one, so you see how the app's storage migrates, up or down.",
        ru: "Keep app data включён по умолчанию: сборка ставится поверх текущей, и видно, как мигрирует хранилище приложения при обновлении или откате.",
        uk: "Keep app data увімкнено за замовчуванням: збірка встановлюється поверх поточної, і видно, як мігрує сховище застосунку під час оновлення чи відкату.",
      },
    },
    {
      target: "build-2.3.1",
      set: { panel: "none", version: "2.3.1", toast: "installing" },
      text: {
        en: "Pick the build you need, for example the one in production, to check whether a bug was already there.",
        ru: "Выберите нужную сборку, например ту, что сейчас в продакшене, чтобы проверить, был ли баг там раньше.",
        uk: "Оберіть потрібну збірку, наприклад ту, що зараз у продакшені, щоб перевірити, чи був баг там раніше.",
      },
    },
    {
      target: "toast",
      action: "look",
      set: { toast: "installed" },
      text: {
        en: "The same device installs it: no new launch, no new device, the settings you changed stay.",
        ru: "Сборка ставится на то же устройство: без нового запуска и нового устройства, изменённые вами настройки остаются.",
        uk: "Збірка встановлюється на той самий пристрій: без нового запуску й нового пристрою, змінені вами налаштування лишаються.",
      },
    },
    {
      target: "version-switcher",
      action: "look",
      text: {
        en: "The header now shows 2.3.1. Switch back the same way when you're done.",
        ru: "В шапке теперь 2.3.1. Вернуться обратно можно так же.",
        uk: "У шапці тепер 2.3.1. Повернутися назад можна так само.",
      },
    },
  ],
} satisfies Scenario
