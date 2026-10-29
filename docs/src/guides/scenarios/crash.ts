import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "phone-buy",
      set: { crashed: true, toast: "crash" },
      text: {
        en: "You tap Buy and the app closes with “keeps stopping”. That's a crash.",
        ru: "Вы нажимаете Buy, и приложение закрывается с сообщением «keeps stopping». Это крэш.",
        uk: "Ви натискаєте Buy, і застосунок закривається з повідомленням «keeps stopping». Це крах.",
      },
    },
    {
      target: "toast",
      action: "look",
      text: {
        en: "Holtdroid notices it and shows the first lines of the error right away, so you don't have to dig for them.",
        ru: "Holtdroid сразу это замечает и показывает первые строки ошибки, искать их не нужно.",
        uk: "Holtdroid одразу це помічає й показує перші рядки помилки, шукати їх не потрібно.",
      },
    },
    {
      target: "toast-action",
      set: { toast: "none", tab: "logcat" },
      text: {
        en: "Logcat opens the device's log. Logcat is Android's own log, where apps and the system write what they do.",
        ru: "Кнопка Logcat открывает журнал устройства. Logcat — это системный журнал Android, куда приложения и система пишут, что делают.",
        uk: "Кнопка Logcat відкриває журнал пристрою. Logcat — це системний журнал Android, куди застосунки й система пишуть, що роблять.",
      },
    },
    {
      target: "log-exception",
      action: "look",
      text: {
        en: "Red lines are errors. The exception and the lines under it point to the exact place in the code: copy them into the bug report.",
        ru: "Красные строки — ошибки. Исключение и строки под ним указывают точное место в коде: скопируйте их в баг-репорт.",
        uk: "Червоні рядки — помилки. Виняток і рядки під ним вказують точне місце в коді: скопіюйте їх у баг-репорт.",
      },
    },
    {
      target: "log-scope",
      set: { logScope: "all" },
      text: {
        en: "This app shows only your app's lines. Everything adds the whole device, if you suspect the system.",
        ru: "This app показывает только строки вашего приложения. Everything добавляет всё устройство, если подозреваете систему.",
        uk: "This app показує лише рядки вашого застосунку. Everything додає весь пристрій, якщо підозрюєте систему.",
      },
    },
    {
      target: "log-level",
      set: { logLevel: "error" },
      text: {
        en: "Filter by level to keep only errors, or by text to find a tag or a message.",
        ru: "Фильтр по уровню оставит только ошибки, а по тексту найдёт нужный тег или сообщение.",
        uk: "Фільтр за рівнем залишить тільки помилки, а за текстом знайде потрібний тег чи повідомлення.",
      },
    },
    {
      target: "log-download",
      text: {
        en: "Download saves exactly what is shown, ready to attach to the ticket.",
        ru: "Download сохраняет ровно то, что сейчас на экране, — готовый файл для тикета.",
        uk: "Download зберігає саме те, що зараз на екрані, — готовий файл для тікета.",
      },
    },
    {
      target: "w-app",
      action: "hover",
      set: { panel: "app" },
      text: {
        en: "After a crash the app stays closed and the device stays on. Open the App card to bring it back.",
        ru: "После крэша приложение остаётся закрытым, а устройство продолжает работать. Откройте карточку App, чтобы вернуть его.",
        uk: "Після краху застосунок лишається закритим, а пристрій працює далі. Відкрийте картку App, щоб повернути його.",
      },
    },
    {
      target: "app-restart",
      set: { panel: "none", crashed: false },
      text: {
        en: "Restart app starts it again. The log keeps the crash, so you can still read it.",
        ru: "Restart app запускает его снова. Крэш в журнале остаётся, его можно дочитать.",
        uk: "Restart app запускає його знову. Крах у журналі лишається, його можна дочитати.",
      },
    },
  ],
} satisfies Scenario
