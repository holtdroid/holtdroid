import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, recording: true, recTime: 74, deviceTab: "media" },
  steps: [
    {
      target: "w-recording",
      action: "look",
      text: {
        en: "The Recording row on the Media tab of the Device panel shows that the server is recording this session and for how long; so does the clock in the header.",
        ru: "Строка Recording на вкладке Media панели Device показывает, что сервер записывает сессию и сколько уже идёт запись; то же видно на часах в шапке.",
        uk: "Рядок Recording на вкладці Media панелі Device показує, що сервер записує сесію і скільки вже триває запис; те саме видно на годиннику в шапці.",
      },
    },
    {
      target: "w-recording",
      set: { markers: 1 },
      text: {
        en: "Something went wrong? Click the row, or the clock in the header: a marker is pinned at this moment, so you find it later without watching everything.",
        ru: "Что-то пошло не так? Кликните по строке или по часам в шапке: в этот момент записи появится метка, и потом не придётся пересматривать всё подряд.",
        uk: "Щось пішло не так? Клацніть по рядку або по годиннику в шапці: у цей момент запису з'явиться мітка, і потім не доведеться переглядати все підряд.",
      },
    },
    {
      target: "w-recording",
      action: "click",
      set: { panel: "recording" },
      text: {
        en: "Open the row with its chevron for the rest: how long it has run, how big it is, and buttons to share, keep or open the recording.",
        ru: "Раскройте строку стрелкой, чтобы увидеть остальное: длительность, размер и кнопки, чтобы поделиться записью, сохранить её или открыть.",
        uk: "Розгорніть рядок стрілкою, щоб побачити решту: тривалість, розмір і кнопки, щоб поділитися записом, зберегти його чи відкрити.",
      },
    },
    {
      target: "rec-mark",
      set: { markers: 2 },
      text: {
        en: "Mark this moment does the same as a click on the row. Put a marker on every step that matters for the bug.",
        ru: "Mark this moment делает то же, что и клик по строке. Ставьте метку на каждом шаге, важном для бага.",
        uk: "Mark this moment робить те саме, що й клік по рядку. Ставте мітку на кожному кроці, важливому для бага.",
      },
    },
    {
      target: "nav-recordings",
      set: { page: "recordings", panel: "none" },
      text: {
        en: "Recordings in the dock lists your recordings, newest first. A recording still in progress can be watched while it grows.",
        ru: "Кнопка Recordings в доке открывает список ваших записей, свежие сверху. Запись, которая ещё идёт, можно смотреть, пока она растёт.",
        uk: "Кнопка Recordings у доку відкриває список ваших записів, свіжі вгорі. Запис, який ще триває, можна дивитися, поки він росте.",
      },
    },
    {
      target: "recording-row",
      set: { page: "recording", recTime: 0 },
      text: {
        en: "Open the recording. It looks like the session page: the state at the playhead on the left, the screen in the middle, the tools on the right and a timeline underneath.",
        ru: "Откройте запись. Она похожа на страницу сессии: состояние в текущий момент слева, экран посередине, инструменты справа и таймлайн внизу.",
        uk: "Відкрийте запис. Він схожий на сторінку сесії: стан у поточний момент ліворуч, екран посередині, інструменти праворуч і таймлайн унизу.",
      },
    },
    {
      target: "rec-play",
      set: { recPlaying: true, recTime: 62 },
      text: {
        en: "Play it like a video. Logcat and the network move along with the picture, so you see what the app did at each moment.",
        ru: "Запустите её как обычное видео. Logcat и сеть идут синхронно с картинкой, поэтому видно, что приложение делало в каждый момент.",
        uk: "Запустіть його як звичайне відео. Logcat і мережа йдуть синхронно з картинкою, тож видно, що застосунок робив у кожен момент.",
      },
    },
    {
      target: "rec-marker-1",
      set: { recPlaying: false, recTime: 121 },
      text: {
        en: "Click a marker to jump straight to the moment you pinned.",
        ru: "Кликните по метке, чтобы сразу перейти к отмеченному моменту.",
        uk: "Клацніть по мітці, щоб одразу перейти до позначеного моменту.",
      },
    },
    {
      target: "rec-tab-network",
      set: { recTab: "network" },
      text: {
        en: "The Network tab shows the WebView's requests up to this moment. The failed one is red: often that's the cause of the bug.",
        ru: "Во вкладке Network видны запросы WebView до этого момента. Упавший запрос красный — часто это и есть причина бага.",
        uk: "У вкладці Network видно запити WebView до цього моменту. Запит, що впав, червоний — часто це і є причина бага.",
      },
    },
    {
      target: "rec-share",
      set: { toast: "rec-link" },
      text: {
        en: "Share makes a public link to this moment and copies it. Paste it into the ticket: the developer opens this exact moment, even without an account.",
        ru: "Share создаёт публичную ссылку на этот момент и копирует её. Вставьте её в задачу: разработчик откроет именно этот момент, даже без аккаунта.",
        uk: "Share створює публічне посилання на цей момент і копіює його. Вставте його в задачу: розробник відкриє саме цей момент, навіть без облікового запису.",
      },
    },
  ],
} satisfies Scenario
