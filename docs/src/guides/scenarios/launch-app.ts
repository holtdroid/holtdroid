import type { Scenario } from "../types"

export default {
  steps: [
    {
      target: "app-card",
      action: "look",
      text: {
        en: "The Apps page lists every app Holtdroid knows about. One card is one app; the newest build is shown first.",
        ru: "На странице Apps собраны все приложения, которые знает Holtdroid. Одна карточка — одно приложение, сверху его самая свежая сборка.",
        uk: "На сторінці Apps зібрано всі застосунки, які знає Holtdroid. Одна картка — один застосунок, угорі його найсвіжіша збірка.",
      },
    },
    {
      target: "launch",
      set: { dialog: "launch" },
      text: {
        en: "Press Launch on the app you want to test. A dialog opens where you choose the device.",
        ru: "Нажмите Launch на нужном приложении. Откроется окно, где выбирается устройство.",
        uk: "Натисніть Launch на потрібному застосунку. Відкриється вікно, де обирається пристрій.",
      },
    },
    {
      target: "provider-emulator",
      text: {
        en: "Virtual device is Android in a container: any version, any screen, ready in about half a minute. Real phone is a physical phone over USB, for the hardware itself.",
        ru: "Virtual device — это Android в контейнере: любая версия, любой экран, готов примерно за полминуты. Real phone — настоящий телефон по USB, когда важно само железо.",
        uk: "Virtual device — це Android у контейнері: будь-яка версія, будь-який екран, готовий приблизно за пів хвилини. Real phone — справжній телефон через USB, коли важливе саме залізо.",
      },
    },
    {
      target: "launch-continue",
      set: { launchStage: "options" },
      text: {
        en: "Continue opens the device settings.",
        ru: "Continue открывает настройки устройства.",
        uk: "Continue відкриває налаштування пристрою.",
      },
    },
    {
      target: "android-15",
      set: { android: "15" },
      text: {
        en: "Pick the Android version. The newest one your app supports is already selected; choose an older one to check a bug a user reported on their phone.",
        ru: "Выберите версию Android. Самая новая из поддерживаемых приложением уже выбрана; старую берите, чтобы проверить баг, который пользователь поймал на своём телефоне.",
        uk: "Оберіть версію Android. Найновішу з тих, що підтримує застосунок, уже обрано; стару беріть, щоб перевірити баг, який користувач спіймав на своєму телефоні.",
      },
    },
    {
      target: "screen-pixel",
      action: "look",
      text: {
        en: "Screen sets the phone model: its size, density and the notch. A small budget phone shows layout problems a big flagship hides.",
        ru: "Screen задаёт модель телефона: размер экрана, плотность и вырез под камеру. На маленьком бюджетном экране видны проблемы вёрстки, которые большой флагман скрывает.",
        uk: "Screen задає модель телефона: розмір екрана, щільність і виріз під камеру. На маленькому бюджетному екрані видно проблеми верстки, які великий флагман приховує.",
      },
    },
    {
      target: "webview",
      action: "look",
      text: {
        en: "WebView is the browser engine that shows web pages inside apps. The newest stable Chromium is preselected; Built-in keeps the one Android shipped with.",
        ru: "WebView — это браузерный движок, который показывает веб-страницы внутри приложений. По умолчанию выбран свежий стабильный Chromium; Built-in оставляет тот, что был в Android изначально.",
        uk: "WebView — це браузерний рушій, що показує вебсторінки всередині застосунків. Типово обрано свіжий стабільний Chromium; Built-in залишає той, що був в Android від початку.",
      },
    },
    {
      target: "launch-location-kz",
      set: { location: "kz" },
      text: {
        en: "VPN location decides which country the device appears to be in. You can change it later too, without restarting.",
        ru: "VPN location решает, из какой страны устройство выходит в интернет. Её можно сменить и позже, без перезапуска.",
        uk: "VPN location визначає, з якої країни пристрій виходить в інтернет. Її можна змінити й пізніше, без перезапуску.",
      },
    },
    {
      target: "data-fresh",
      action: "look",
      text: {
        en: "App data: Fresh install starts the app as if it was just downloaded. If you saved a session earlier, you can start from that save and skip signing in.",
        ru: "App data: Fresh install запускает приложение как только что скачанное. Если раньше вы сохраняли данные сессии, можно стартовать с них и не логиниться заново.",
        uk: "App data: Fresh install запускає застосунок як щойно завантажений. Якщо раніше ви зберігали дані сесії, можна стартувати з них і не входити заново.",
      },
    },
    {
      target: "record",
      set: { record: true, recording: true },
      text: {
        en: "Turn on Record the session if you want to watch it later or attach it to a bug report.",
        ru: "Включите Record the session, если хотите потом пересмотреть сессию или приложить её к баг-репорту.",
        uk: "Увімкніть Record the session, якщо хочете потім переглянути сесію або додати її до баг-репорту.",
      },
    },
    {
      target: "launch-submit",
      set: { dialog: "none", page: "session", start: "booting", sessions: 1 },
      text: {
        en: "Press Launch. Holtdroid takes a free device and opens the session page.",
        ru: "Нажмите Launch. Holtdroid берёт свободное устройство и открывает страницу сессии.",
        uk: "Натисніть Launch. Holtdroid бере вільний пристрій і відкриває сторінку сесії.",
      },
    },
    {
      target: "start-progress",
      action: "look",
      set: { start: "instrumenting" },
      text: {
        en: "While it starts you see each stage: booting Android, installing the WebView and your APK, turning on debugging. Usually under a minute.",
        ru: "Пока устройство стартует, видно каждый этап: загрузка Android, установка WebView и вашего APK, включение отладки. Обычно это меньше минуты.",
        uk: "Поки пристрій стартує, видно кожен етап: завантаження Android, встановлення WebView і вашого APK, увімкнення налагодження. Зазвичай це менше хвилини.",
      },
    },
    {
      target: "state-badge",
      action: "look",
      set: { start: "ready" },
      text: {
        en: "Ready: the app is open on the device. The badge next to the name always shows the device's state.",
        ru: "Ready: приложение открыто на устройстве. Значок рядом с названием всегда показывает состояние устройства.",
        uk: "Ready: застосунок відкрито на пристрої. Значок поруч із назвою завжди показує стан пристрою.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "Use the phone right in the browser: click to tap, drag to swipe, type on your keyboard. The app is yours to test.",
        ru: "Пользуйтесь телефоном прямо в браузере: клик — это тап, перетаскивание — свайп, текст набирается с вашей клавиатуры. Можно тестировать.",
        uk: "Користуйтеся телефоном просто в браузері: клік — це тап, перетягування — свайп, текст набирається з вашої клавіатури. Можна тестувати.",
      },
    },
  ],
} satisfies Scenario
