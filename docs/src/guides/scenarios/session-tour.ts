import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "version-switcher",
      action: "look",
      text: {
        en: "The header shows what runs here: the app and its build, and under them the device, Android, WebView and VPN country. Click the name to install another build of the same app.",
        ru: "В шапке видно, что здесь запущено: приложение и его сборка, а под ними устройство, Android, WebView и страна VPN. Клик по названию ставит другую сборку того же приложения.",
        uk: "У шапці видно, що тут запущено: застосунок і його збірка, а під ними пристрій, Android, WebView і країна VPN. Клік по назві встановлює іншу збірку того самого застосунку.",
      },
    },
    {
      target: "state-badge",
      action: "look",
      text: {
        en: "The badge is the device's state. Ready means you can work; anything else means it is still starting or stopping.",
        ru: "Значок — это состояние устройства. Ready — можно работать; всё остальное значит, что оно ещё запускается или останавливается.",
        uk: "Значок — це стан пристрою. Ready — можна працювати; усе інше означає, що він ще запускається або зупиняється.",
      },
    },
    {
      target: "session-timer",
      action: "look",
      text: {
        en: "The bar and the time count down to the moment the device is taken back if nobody uses it.",
        ru: "Полоска и время отсчитывают до момента, когда устройство заберут, если им никто не пользуется.",
        uk: "Смужка й час відлічують до моменту, коли пристрій заберуть, якщо ним ніхто не користується.",
      },
    },
    {
      target: "extend",
      action: "look",
      text: {
        en: "Extend restarts the countdown when you step away for a while and want to keep the device.",
        ru: "Extend перезапускает отсчёт, если вы ненадолго отходите и хотите сохранить устройство.",
        uk: "Extend перезапускає відлік, якщо ви ненадовго відходите й хочете зберегти пристрій.",
      },
    },
    {
      target: "stop",
      action: "look",
      text: {
        en: "Stop ends the session and frees the device for others. Press it when you are done.",
        ru: "Stop завершает сессию и освобождает устройство для других. Нажимайте, когда закончили.",
        uk: "Stop завершує сесію і звільняє пристрій для інших. Натискайте, коли закінчили.",
      },
    },
    {
      target: "device-panel",
      action: "look",
      text: {
        en: "The Device panel on the left holds the device's controls in three tabs: Environment (network, location, battery, language, time, clipboard, display), Media (stream, microphone, camera, recording) and App (the app, the device, SSH).",
        ru: "Панель Device слева собирает настройки устройства в три вкладки: Environment (сеть, местоположение, батарея, язык, время, буфер обмена, экран), Media (трансляция, микрофон, камера, запись) и App (приложение, устройство, SSH).",
        uk: "Панель Device ліворуч збирає налаштування пристрою у три вкладки: Environment (мережа, розташування, батарея, мова, час, буфер обміну, екран), Media (трансляція, мікрофон, камера, запис) і App (застосунок, пристрій, SSH).",
      },
    },
    {
      target: "w-network",
      action: "click",
      set: { panel: "network" },
      text: {
        en: "Each row shows a summary, and its chevron opens it in place. Here the Network row lets you switch the country or make the connection slow; a changed row is marked Changed.",
        ru: "Каждая строка показывает сводку, а стрелка раскрывает её на месте. Строка Network, например, меняет страну или делает связь медленной; изменённая строка помечена Changed.",
        uk: "Кожен рядок показує зведення, а стрілка розгортає його на місці. Рядок Network, наприклад, змінює країну або робить зв'язок повільним; змінений рядок позначено Changed.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "In the middle is the device's screen. Click to tap, drag to swipe, and type with your own keyboard.",
        ru: "В центре — экран устройства. Клик — это тап, перетаскивание — свайп, печатать можно со своей клавиатуры.",
        uk: "У центрі — екран пристрою. Клік — це тап, перетягування — свайп, друкувати можна зі своєї клавіатури.",
      },
    },
    {
      target: "stage-toolbar",
      action: "look",
      text: {
        en: "The toolbar beside the screen has Back, Home and Recent apps, the notifications and quick settings, rotation, a screenshot, the keyboard mode, volume, power and Restart app.",
        ru: "На панели инструментов рядом с экраном — Назад, Домой и недавние приложения, уведомления и быстрые настройки, поворот, скриншот, режим клавиатуры, громкость, питание и Restart app.",
        uk: "На панелі інструментів поруч з екраном — Назад, Додому й нещодавні застосунки, сповіщення та швидкі налаштування, поворот, знімок екрана, режим клавіатури, гучність, живлення і Restart app.",
      },
    },
    {
      target: "tab-devtools",
      action: "look",
      text: {
        en: "On the right are the tools: DevTools for the app's web pages, WebSockets, logs, files, a terminal and design checks.",
        ru: "Справа — инструменты: DevTools для веб-страниц приложения, WebSockets, логи, файлы, терминал и сверка с дизайном.",
        uk: "Праворуч — інструменти: DevTools для вебсторінок застосунку, WebSockets, логи, файли, термінал і звірка з дизайном.",
      },
    },
    {
      target: "tab-logcat",
      set: { tab: "logcat" },
      text: {
        en: "Switch tabs at any time; each keeps its state, so nothing is lost when you come back.",
        ru: "Переключайте вкладки когда угодно: каждая помнит своё состояние, при возврате ничего не теряется.",
        uk: "Перемикайте вкладки будь-коли: кожна пам'ятає свій стан, після повернення нічого не губиться.",
      },
    },
  ],
} satisfies Scenario
