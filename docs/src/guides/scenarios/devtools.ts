import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, tab: "devtools", devtools: "elements" },
  steps: [
    {
      target: "tab-devtools",
      action: "look",
      text: {
        en: "DevTools is the tab next to the phone. It is Chrome's own developer tools, connected to the web pages inside the app. Holtdroid turns debugging on by itself; the APK stays as it is.",
        ru: "DevTools — вкладка рядом с телефоном. Это обычные инструменты разработчика Chrome, подключённые к веб-страницам внутри приложения. Отладку Holtdroid включает сам, APK при этом не меняется.",
        uk: "DevTools — вкладка поруч із телефоном. Це звичайні інструменти розробника Chrome, підключені до вебсторінок усередині застосунку. Налагодження Holtdroid вмикає сам, APK при цьому не змінюється.",
      },
    },
    {
      target: "dt-network",
      set: { devtools: "network" },
      text: {
        en: "Open Network. Every request the web part of the app makes shows up here, with its status, size and time.",
        ru: "Откройте Network. Здесь видны все запросы, которые делает веб-часть приложения: статус, размер и время.",
        uk: "Відкрийте Network. Тут видно всі запити, які робить вебчастина застосунку: статус, розмір і час.",
      },
    },
    {
      target: "req-cart",
      set: { request: "cart" },
      text: {
        en: "A red line is a failed request. Click it to see what was sent and what came back.",
        ru: "Красная строка — запрос с ошибкой. Нажмите на неё, чтобы увидеть, что ушло на сервер и что вернулось.",
        uk: "Червоний рядок — запит із помилкою. Натисніть на нього, щоб побачити, що пішло на сервер і що повернулося.",
      },
    },
    {
      target: "req-details",
      action: "look",
      text: {
        en: "Headers, the response body and timing are all there. Copy them straight into the bug report: the server said the price doesn't match.",
        ru: "Заголовки, тело ответа и тайминги — всё на месте. Их можно сразу скопировать в баг-репорт: сервер ответил, что цена не совпадает.",
        uk: "Заголовки, тіло відповіді й таймінги — усе на місці. Їх можна одразу скопіювати в баг-репорт: сервер відповів, що ціна не збігається.",
      },
    },
    {
      target: "dt-console",
      set: { devtools: "console" },
      text: {
        en: "Console shows the page's messages and errors, the same ones a web developer sees in a desktop browser.",
        ru: "Console показывает сообщения и ошибки страницы — те же, что веб-разработчик видит в браузере на компьютере.",
        uk: "Console показує повідомлення та помилки сторінки — ті самі, що веброзробник бачить у браузері на комп'ютері.",
      },
    },
    {
      target: "console-error",
      action: "look",
      text: {
        en: "A red line is an error in the page's code, with the file and line where it happened. That is usually the first thing a developer asks for.",
        ru: "Красная строка — ошибка в коде страницы, с файлом и строкой, где она случилась. Обычно разработчик первым делом просит именно её.",
        uk: "Червоний рядок — помилка в коді сторінки, з файлом і рядком, де вона сталася. Зазвичай розробник насамперед просить саме її.",
      },
    },
    {
      target: "dt-elements",
      set: { devtools: "elements" },
      text: {
        en: "Elements shows the page's HTML and styles. Pick an element to see why it looks the way it does.",
        ru: "Elements показывает HTML и стили страницы. Выберите элемент, чтобы понять, почему он выглядит именно так.",
        uk: "Elements показує HTML і стилі сторінки. Оберіть елемент, щоб зрозуміти, чому він виглядає саме так.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "Keep using the app while DevTools is open: new requests and messages appear as they happen.",
        ru: "Пользуйтесь приложением, не закрывая DevTools: новые запросы и сообщения появляются сразу.",
        uk: "Користуйтеся застосунком, не закриваючи DevTools: нові запити й повідомлення з'являються одразу.",
      },
    },
  ],
} satisfies Scenario
