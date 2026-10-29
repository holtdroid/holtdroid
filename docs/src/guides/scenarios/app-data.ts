import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-app",
      action: "hover",
      set: { panel: "app" },
      text: {
        en: "You've signed in and clicked through onboarding. Hover the App card next to the phone to open the app's actions.",
        ru: "Вы залогинились и прошли онбординг. Наведите курсор на карточку App рядом с телефоном, чтобы открыть действия с приложением.",
        uk: "Ви увійшли й пройшли онбординг. Наведіть курсор на картку App поруч із телефоном, щоб відкрити дії із застосунком.",
      },
    },
    {
      target: "app-save",
      set: { panel: "none", toast: "saved" },
      text: {
        en: "Save app data copies the app's private storage: logins, settings, databases, WebView cookies. The app is stopped while it's copied and started again.",
        ru: "Save app data копирует приватное хранилище приложения: логины, настройки, базы данных, cookies WebView. На время копирования приложение останавливается и потом запускается снова.",
        uk: "Save app data копіює приватне сховище застосунку: логіни, налаштування, бази даних, cookies WebView. Під час копіювання застосунок зупиняється, а потім запускається знову.",
      },
    },
    {
      target: "stop",
      set: { toast: "none", start: "stopping" },
      text: {
        en: "Stop saves the data too, so usually you don't need the button at all: just stop the session when you're done.",
        ru: "Stop тоже сохраняет данные, так что обычно отдельная кнопка не нужна: просто остановите сессию, когда закончите.",
        uk: "Stop теж зберігає дані, тож зазвичай окрема кнопка не потрібна: просто зупиніть сесію, коли закінчите.",
      },
    },
    {
      target: "stop",
      action: "look",
      set: { page: "home", sessions: 0, start: "ready" },
      text: {
        en: "Stop waits for the save to finish, then gives the device back. A big save makes stopping a bit slower.",
        ru: "Stop ждёт, пока сохранение закончится, и только потом отдаёт устройство. Большое сохранение делает остановку чуть дольше.",
        uk: "Stop чекає, доки збереження завершиться, і лише потім віддає пристрій. Велике збереження робить зупинку трохи довшою.",
      },
    },
    {
      target: "launch",
      set: { dialog: "launch" },
      text: {
        en: "Next time, launch the same app as usual.",
        ru: "В следующий раз запустите то же приложение как обычно.",
        uk: "Наступного разу запустіть той самий застосунок як завжди.",
      },
    },
    {
      target: "launch-continue",
      set: { launchStage: "options" },
      text: {
        en: "Continue, then scroll down to the App data section.",
        ru: "Нажмите Continue и прокрутите вниз до раздела App data.",
        uk: "Натисніть Continue і прокрутіть униз до розділу App data.",
      },
    },
    {
      target: "data-saved",
      set: { appData: "saved" },
      text: {
        en: "Your saves are listed newest first, with the build they came from. Pick one instead of Fresh install.",
        ru: "Ваши сохранения идут от новых к старым, с версией сборки, из которой они сделаны. Выберите одно вместо Fresh install.",
        uk: "Ваші збереження йдуть від нових до старих, із версією збірки, з якої їх зроблено. Оберіть одне замість Fresh install.",
      },
    },
    {
      target: "data-cache",
      set: { cache: true },
      text: {
        en: "Also restore the cache brings back cached files too, when the save has them. Without it the app rebuilds its cache on its own.",
        ru: "Also restore the cache возвращает и закешированные файлы, если они есть в сохранении. Без этого приложение само заново наполнит кеш.",
        uk: "Also restore the cache повертає й закешовані файли, якщо вони є у збереженні. Без цього застосунок сам заново наповнить кеш.",
      },
    },
    {
      target: "launch-submit",
      set: { dialog: "none", page: "session", start: "restoring", sessions: 1 },
      text: {
        en: "Launch. The app is installed fresh, and the saved data is put back before it starts.",
        ru: "Нажмите Launch. Приложение ставится заново, а сохранённые данные возвращаются до его запуска.",
        uk: "Натисніть Launch. Застосунок встановлюється заново, а збережені дані повертаються до його запуску.",
      },
    },
    {
      target: "start-progress",
      action: "look",
      set: { start: "ready" },
      text: {
        en: "An extra step, Restoring app data, appears in the progress list.",
        ru: "В списке этапов появляется дополнительный шаг Restoring app data.",
        uk: "У списку етапів з'являється додатковий крок Restoring app data.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "The app opens where you left it: already signed in, onboarding done.",
        ru: "Приложение открывается там, где вы остановились: вы уже залогинены, онбординг пройден.",
        uk: "Застосунок відкривається там, де ви зупинилися: ви вже увійшли, онбординг пройдено.",
      },
    },
  ],
} satisfies Scenario
