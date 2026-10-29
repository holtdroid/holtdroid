import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, recording: true, recTime: 74 },
  steps: [
    {
      target: "w-recording",
      action: "look",
      text: {
        en: "The Recording card next to the screen shows that the server is recording this session and for how long.",
        ru: "Карточка Recording рядом с экраном показывает, что сервер записывает сессию, и сколько уже идёт запись.",
        uk: "Картка Recording поруч з екраном показує, що сервер записує сесію, і скільки вже триває запис.",
      },
    },
    {
      target: "w-recording",
      set: { markers: 1 },
      text: {
        en: "Something went wrong? Click the card: a marker is pinned at this moment, so you find it later without watching everything.",
        ru: "Что-то пошло не так? Кликните по карточке: в этот момент записи появится метка, и потом не придётся пересматривать всё подряд.",
        uk: "Щось пішло не так? Клацніть по картці: у цей момент запису з'явиться мітка, і потім не доведеться переглядати все підряд.",
      },
    },
    {
      target: "w-recording",
      action: "hover",
      set: { panel: "recording" },
      text: {
        en: "Hover the card for the rest: how long it has run, how big it is, and buttons to share, keep or open the recording.",
        ru: "Наведите курсор на карточку, чтобы увидеть остальное: длительность, размер и кнопки, чтобы поделиться записью, сохранить её или открыть.",
        uk: "Наведіть курсор на картку, щоб побачити решту: тривалість, розмір і кнопки, щоб поділитися записом, зберегти його чи відкрити.",
      },
    },
    {
      target: "rec-mark",
      set: { markers: 2 },
      text: {
        en: "Mark this moment does the same as a click on the card. Put a marker on every step that matters for the bug.",
        ru: "Mark this moment делает то же, что и клик по карточке. Ставьте метку на каждом шаге, важном для бага.",
        uk: "Mark this moment робить те саме, що й клік по картці. Ставте мітку на кожному кроці, важливому для бага.",
      },
    },
    {
      target: "nav-recordings",
      set: { page: "recordings", panel: "none" },
      text: {
        en: "Recordings in the header lists your recordings, newest first. A recording still in progress can be watched while it grows.",
        ru: "Кнопка Recordings в шапке открывает список ваших записей, свежие сверху. Запись, которая ещё идёт, можно смотреть, пока она растёт.",
        uk: "Кнопка Recordings у шапці відкриває список ваших записів, свіжі вгорі. Запис, який ще триває, можна дивитися, поки він росте.",
      },
    },
    {
      target: "recording-row",
      set: { page: "recording", recTime: 0 },
      text: {
        en: "Open the recording. It looks like the session page: device cards on the left, the phone in the middle, logs on the right.",
        ru: "Откройте запись. Она похожа на страницу сессии: карточки устройства слева, телефон посередине, логи справа.",
        uk: "Відкрийте запис. Він схожий на сторінку сесії: картки пристрою ліворуч, телефон посередині, логи праворуч.",
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
        en: "Share makes a link and copies it. Paste it into the ticket: the developer opens this exact moment, even without an account.",
        ru: "Share создаёт ссылку и копирует её. Вставьте её в задачу: разработчик откроет именно этот момент, даже без аккаунта.",
        uk: "Share створює посилання і копіює його. Вставте його в задачу: розробник відкриє саме цей момент, навіть без облікового запису.",
      },
    },
  ],
} satisfies Scenario
