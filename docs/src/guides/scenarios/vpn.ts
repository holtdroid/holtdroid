import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-network",
      action: "look",
      text: {
        en: "The Network card next to the phone shows where the device goes online: the country and its public IP address.",
        ru: "Карточка Network рядом с телефоном показывает, откуда устройство выходит в интернет: страну и внешний IP-адрес.",
        uk: "Картка Network поруч із телефоном показує, звідки пристрій виходить в інтернет: країну та зовнішню IP-адресу.",
      },
    },
    {
      target: "w-network",
      action: "hover",
      set: { panel: "network" },
      text: {
        en: "Hover the card to open its panel. VPN location lists every country this Holtdroid offers.",
        ru: "Наведите курсор на карточку, чтобы открыть панель. В разделе VPN location перечислены все страны, которые есть в этом Holtdroid.",
        uk: "Наведіть курсор на картку, щоб відкрити панель. У розділі VPN location перелічено всі країни, які є в цьому Holtdroid.",
      },
    },
    {
      target: "vpn-nl",
      action: "look",
      text: {
        en: "The current location is highlighted. All of the device's traffic, including DNS, goes through it.",
        ru: "Текущая локация подсвечена. Через неё идёт весь трафик устройства, включая DNS-запросы.",
        uk: "Поточну локацію підсвічено. Через неї йде весь трафік пристрою, разом із DNS-запитами.",
      },
    },
    {
      target: "vpn-kz",
      set: { location: "kz", locationBusy: true },
      text: {
        en: "Click another country. The switch happens on the fly: no restart, the app keeps running.",
        ru: "Нажмите на другую страну. Переключение происходит на лету: без перезапуска, приложение продолжает работать.",
        uk: "Натисніть іншу країну. Перемикання відбувається на льоту: без перезапуску, застосунок працює далі.",
      },
    },
    {
      target: "vpn-kz",
      action: "look",
      set: { locationBusy: false },
      text: {
        en: "A second later the device has a Kazakh IP address. Servers now see a user from Kazakhstan.",
        ru: "Через секунду у устройства казахстанский IP. Для серверов это теперь пользователь из Казахстана.",
        uk: "За секунду в пристрою казахстанська IP-адреса. Для серверів це тепер користувач із Казахстану.",
      },
    },
    {
      target: "phone-price",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "Pull to refresh in the app and check what changed: here the prices are now in tenge. This is how you test regional prices, content and restrictions.",
        ru: "Обновите экран в приложении и посмотрите, что изменилось: здесь цены теперь в тенге. Так проверяют региональные цены, контент и ограничения.",
        uk: "Оновіть екран у застосунку й подивіться, що змінилося: тут ціни тепер у тенге. Так перевіряють регіональні ціни, контент і обмеження.",
      },
    },
    {
      target: "tab-devtools",
      set: { tab: "devtools", devtools: "network" },
      text: {
        en: "To see what the server answered, open DevTools next to the phone.",
        ru: "Чтобы увидеть, что ответил сервер, откройте DevTools рядом с телефоном.",
        uk: "Щоб побачити, що відповів сервер, відкрийте DevTools поруч із телефоном.",
      },
    },
    {
      target: "req-price",
      set: { request: "price" },
      text: {
        en: "The prices request shows the region the server detected. Handy when you need to prove a bug is on the backend.",
        ru: "В запросе цен видно регион, который определил сервер. Удобно, когда нужно доказать, что баг на бэкенде.",
        uk: "У запиті цін видно регіон, який визначив сервер. Зручно, коли треба довести, що баг на бекенді.",
      },
    },
  ],
} satisfies Scenario
