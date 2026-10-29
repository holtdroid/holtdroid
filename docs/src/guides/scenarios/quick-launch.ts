import type { Scenario } from "../types"

export default {
  steps: [
    {
      target: "quick-launch",
      action: "look",
      text: {
        en: "Next to Launch sits the lightning button. It starts a device right away, without the launch dialog.",
        ru: "Рядом с Launch есть кнопка с молнией. Она сразу запускает устройство, без окна настроек.",
        uk: "Поруч із Launch є кнопка з блискавкою. Вона одразу запускає пристрій, без вікна налаштувань.",
      },
    },
    {
      target: "quick-launch",
      action: "hover",
      set: { panel: "quick" },
      text: {
        en: "Hover it to see how it will launch. The top line shows the device it uses: the provider and settings of your last launch.",
        ru: "Наведите на неё курсор, чтобы увидеть, как она запустит. Вверху написано устройство: провайдер и настройки вашего прошлого запуска.",
        uk: "Наведіть на неї курсор, щоб побачити, як вона запустить. Угорі написано пристрій: провайдер і налаштування вашого минулого запуску.",
      },
    },
    {
      target: "quick-fresh",
      action: "look",
      text: {
        en: "Fresh install starts the app as if it was just downloaded, with nothing saved.",
        ru: "Fresh install запускает приложение как только что скачанное, без сохранённых данных.",
        uk: "Fresh install запускає застосунок як щойно завантажений, без збережених даних.",
      },
    },
    {
      target: "quick-data",
      action: "look",
      text: {
        en: "With app data starts from your newest save of this app: you are already signed in and past the onboarding.",
        ru: "With app data стартует с вашего последнего сохранения этого приложения: вы уже залогинены и онбординг пройден.",
        uk: "With app data стартує з вашого останнього збереження цього застосунку: ви вже увійшли, онбординг пройдено.",
      },
    },
    {
      target: "quick-cache",
      action: "look",
      text: {
        en: "With app data and cache also brings back the cache, so images and pages load as on a phone that has been in use.",
        ru: "With app data and cache возвращает ещё и кеш: картинки и страницы грузятся как на телефоне, которым уже пользовались.",
        uk: "With app data and cache повертає ще й кеш: картинки й сторінки вантажаться як на телефоні, яким уже користувалися.",
      },
    },
    {
      target: "quick-data",
      set: { panel: "none", page: "session", sessions: 1, appData: "saved", start: "restoring" },
      text: {
        en: "Pick one and the device starts at once. Your choice is remembered, so next time a plain click on the button does the same.",
        ru: "Выберите вариант, и устройство сразу запускается. Выбор запоминается: в следующий раз хватит простого клика по кнопке.",
        uk: "Оберіть варіант, і пристрій одразу запускається. Вибір запам'ятовується: наступного разу вистачить простого кліку по кнопці.",
      },
    },
    {
      target: "start-progress",
      action: "look",
      set: { start: "ready" },
      text: {
        en: "The start looks the same as a normal launch, with one more stage: restoring the app data.",
        ru: "Запуск выглядит как обычный, только с ещё одним этапом — восстановлением данных приложения.",
        uk: "Запуск виглядає як звичайний, тільки з ще одним етапом — відновленням даних застосунку.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "Ready: the app opens where you left it last time.",
        ru: "Готово: приложение открывается там, где вы остановились в прошлый раз.",
        uk: "Готово: застосунок відкривається там, де ви зупинилися минулого разу.",
      },
    },
  ],
} satisfies Scenario
