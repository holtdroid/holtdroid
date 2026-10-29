import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, tab: "devtools" },
  steps: [
    {
      target: "tab-websockets",
      set: { tab: "websockets" },
      text: {
        en: "Open the WebSockets tab. A WebSocket is a connection that stays open, so the server can push updates: prices, chat messages, order status.",
        ru: "Откройте вкладку WebSockets. WebSocket — это соединение, которое остаётся открытым, чтобы сервер сам присылал обновления: цены, сообщения чата, статус заказа.",
        uk: "Відкрийте вкладку WebSockets. WebSocket — це з'єднання, що лишається відкритим, щоб сервер сам надсилав оновлення: ціни, повідомлення чату, статус замовлення.",
      },
    },
    {
      target: "frame-hello",
      action: "look",
      text: {
        en: "Each line is one message. A green arrow up is what the app sent, a red arrow down is what the server sent back.",
        ru: "Каждая строка — одно сообщение. Зелёная стрелка вверх — то, что отправило приложение, красная вниз — то, что прислал сервер.",
        uk: "Кожен рядок — одне повідомлення. Зелена стрілка вгору — те, що надіслав застосунок, червона вниз — те, що прислав сервер.",
      },
    },
    {
      target: "frame-price",
      set: { socket: "price" },
      text: {
        en: "Click a message to read it in full.",
        ru: "Нажмите на сообщение, чтобы прочитать его целиком.",
        uk: "Натисніть на повідомлення, щоб прочитати його повністю.",
      },
    },
    {
      target: "frame-details",
      action: "look",
      text: {
        en: "The data is laid out readably below the list. Here the server sent the price of an item.",
        ru: "Ниже списка данные показаны в читаемом виде. Здесь сервер прислал цену товара.",
        uk: "Нижче списку дані показано в зручному вигляді. Тут сервер надіслав ціну товару.",
      },
    },
    {
      target: "frame-order",
      set: { socket: "order" },
      text: {
        en: "Looking for a bug? Find the message right before things went wrong.",
        ru: "Ищете баг? Найдите сообщение прямо перед тем, как всё пошло не так.",
        uk: "Шукаєте баг? Знайдіть повідомлення одразу перед тим, як усе пішло не так.",
      },
    },
    {
      target: "frame-details",
      action: "look",
      text: {
        en: "The order failed with out_of_stock: the app got the error, but never showed it to the user. That is a bug report with proof.",
        ru: "Заказ не прошёл с ошибкой out_of_stock: приложение её получило, но пользователю не показало. Это баг-репорт с доказательством.",
        uk: "Замовлення не пройшло з помилкою out_of_stock: застосунок її отримав, але користувачеві не показав. Це баг-репорт із доказом.",
      },
    },
    {
      target: "tab-websockets",
      action: "look",
      text: {
        en: "The tab works without DevTools open and keeps the traffic since the app started, even if you reload the portal page.",
        ru: "Вкладка работает без открытого DevTools и хранит трафик с момента запуска приложения, даже если перезагрузить страницу портала.",
        uk: "Вкладка працює без відкритого DevTools і зберігає трафік від запуску застосунку, навіть якщо перезавантажити сторінку порталу.",
      },
    },
  ],
} satisfies Scenario
