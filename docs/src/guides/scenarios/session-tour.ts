import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "version-switcher",
      action: "look",
      text: {
        en: "The header shows what runs here: the app, its package, the build and the device. Click the name to install another build of the same app.",
        ru: "В шапке видно, что здесь запущено: приложение, его пакет, сборка и устройство. Клик по названию ставит другую сборку того же приложения.",
        uk: "У шапці видно, що тут запущено: застосунок, його пакет, збірка і пристрій. Клік по назві встановлює іншу збірку того самого застосунку.",
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
        en: "The clock counts down to the moment the device is taken back if nobody uses it.",
        ru: "Часы отсчитывают время до момента, когда устройство заберут, если им никто не пользуется.",
        uk: "Годинник відлічує час до моменту, коли пристрій заберуть, якщо ним ніхто не користується.",
      },
    },
    {
      target: "share",
      action: "look",
      text: {
        en: "Share copies a link to this session. A colleague who opens it sees the same device live, handy when you want a second pair of eyes on a bug.",
        ru: "Share копирует ссылку на эту сессию. Коллега, открыв её, увидит то же устройство вживую — удобно, когда нужен второй взгляд на баг.",
        uk: "Share копіює посилання на цю сесію. Колега, відкривши його, побачить той самий пристрій наживо — зручно, коли потрібен другий погляд на баг.",
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
      target: "widgets",
      action: "look",
      text: {
        en: "The dark cards on the left are the device's quick settings: the app, network and country, GPS, display, clipboard, battery, language, clock and more.",
        ru: "Тёмные карточки слева — быстрые настройки устройства: приложение, сеть и страна, GPS, экран, буфер обмена, батарея, язык, часы и другое.",
        uk: "Темні картки ліворуч — швидкі налаштування пристрою: застосунок, мережа й країна, GPS, екран, буфер обміну, батарея, мова, годинник та інше.",
      },
    },
    {
      target: "w-network",
      action: "hover",
      set: { panel: "network" },
      text: {
        en: "Hover a card to open its panel. Here the network card lets you switch the country or make the connection slow.",
        ru: "Наведите курсор на карточку, чтобы открыть её панель. Карточка сети, например, меняет страну или делает связь медленной.",
        uk: "Наведіть курсор на картку, щоб відкрити її панель. Картка мережі, наприклад, змінює країну або робить зв'язок повільним.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "In the middle is the phone itself. Click to tap, drag to swipe, and type with your own keyboard.",
        ru: "В центре — сам телефон. Клик — это тап, перетаскивание — свайп, печатать можно со своей клавиатуры.",
        uk: "У центрі — сам телефон. Клік — це тап, перетягування — свайп, друкувати можна зі своєї клавіатури.",
      },
    },
    {
      target: "phone-buttons",
      action: "look",
      text: {
        en: "The keys on the side of the frame work like real ones: power, volume and more. Back, Home and Recent apps are on the phone's bottom edge.",
        ru: "Кнопки на боку корпуса работают как настоящие: питание, громкость и другие. Назад, домой и недавние приложения — внизу телефона.",
        uk: "Кнопки на боці корпусу працюють як справжні: живлення, гучність та інші. Назад, додому і нещодавні застосунки — внизу телефона.",
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
