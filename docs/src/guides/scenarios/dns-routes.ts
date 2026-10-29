import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, tab: "devtools" },
  steps: [
    {
      target: "tab-dns",
      set: { tab: "dns" },
      text: {
        en: "Open DNS next to DevTools. Every name the device looks up appears here as it happens, with the addresses it got.",
        ru: "Откройте DNS рядом с DevTools. Здесь в реальном времени видно каждое имя, которое ищет устройство, и адреса, которые оно получило.",
        uk: "Відкрийте DNS поруч із DevTools. Тут у реальному часі видно кожне ім'я, яке шукає пристрій, і адреси, які він отримав.",
      },
    },
    {
      target: "dns-row-ads",
      action: "look",
      text: {
        en: "Ordinary answers have no marks; problems stand out. NXDOMAIN means the name doesn't exist: a typo in a config or a domain that was shut down.",
        ru: "У обычных ответов нет пометок, проблемы сразу видны. NXDOMAIN значит, что такого имени нет: опечатка в конфиге или отключённый домен.",
        uk: "Звичайні відповіді не мають позначок, проблеми одразу видно. NXDOMAIN означає, що такого імені немає: помилка в конфігу або вимкнений домен.",
      },
    },
    {
      target: "dns-row-img",
      action: "look",
      text: {
        en: "far: every address is on another continent than the VPN exit. Here images come from Brazil to a device in the Netherlands, so every request crosses the ocean.",
        ru: "far: все адреса на другом континенте, чем выход VPN. Здесь картинки едут из Бразилии на устройство в Нидерландах, и каждый запрос пересекает океан.",
        uk: "far: усі адреси на іншому континенті, ніж вихід VPN. Тут картинки їдуть із Бразилії на пристрій у Нідерландах, і кожен запит перетинає океан.",
      },
    },
    {
      target: "dns-row-doh",
      action: "look",
      text: {
        en: "Block DoH keeps browsers and apps on the device's DNS: their own encrypted DNS would skip the log. Chrome's retries fold into one row with a count.",
        ru: "Block DoH удерживает браузеры и приложения на DNS устройства: их собственный шифрованный DNS обходил бы журнал. Повторы Chrome сворачиваются в одну строку со счётчиком.",
        uk: "Block DoH утримує браузери та застосунки на DNS пристрою: їхній власний шифрований DNS оминав би журнал. Повтори Chrome згортаються в один рядок із лічильником.",
      },
    },
    {
      target: "dns-row-api",
      set: { dnsQuery: "api" },
      text: {
        en: "Click a row for the details: the CNAME chain, every address with its country and network, and the TTL the device got next to the real one.",
        ru: "Клик по строке открывает подробности: цепочку CNAME, каждый адрес со страной и сетью, и TTL, который получило устройство, рядом с настоящим.",
        uk: "Клік по рядку відкриває подробиці: ланцюжок CNAME, кожну адресу з країною та мережею, і TTL, який отримав пристрій, поруч зі справжнім.",
      },
    },
    {
      target: "dns-rewrite-btn",
      set: { dnsView: "rewrites", dnsRewrite: true },
      text: {
        en: "Rewrite this name to point the production app at a staging server: answer api.shop.example.com with 10.0.4.12. No rebuild, no hosts file.",
        ru: "Rewrite this name направляет боевое приложение на стейджинг: отвечаем на api.shop.example.com адресом 10.0.4.12. Без пересборки и без hosts.",
        uk: "Rewrite this name спрямовує бойовий застосунок на стейджинг: відповідаємо на api.shop.example.com адресою 10.0.4.12. Без перезбирання і без hosts.",
      },
    },
    {
      target: "dns-rule",
      action: "look",
      text: {
        en: "A rewrite can also block a name or make it not exist, to test what the app does when an analytics or payment domain is down. TTL 0 makes switching it off instant.",
        ru: "Rewrite может и заблокировать имя или сделать его несуществующим — так проверяют, что делает приложение, когда домен аналитики или оплаты недоступен. TTL 0 делает выключение мгновенным.",
        uk: "Rewrite може й заблокувати ім'я або зробити його неіснуючим — так перевіряють, що робить застосунок, коли домен аналітики чи оплати недоступний. TTL 0 робить вимкнення миттєвим.",
      },
    },
    {
      target: "tab-routes",
      set: { tab: "routes" },
      text: {
        en: "Routes shows where the connections actually go: from the device through the VPN location and its exit address to each server.",
        ru: "Routes показывает, куда на самом деле идут соединения: от устройства через VPN-локацию и её адрес выхода до каждого сервера.",
        uk: "Routes показує, куди насправді йдуть з'єднання: від пристрою через VPN-локацію та її адресу виходу до кожного сервера.",
      },
    },
    {
      target: "route-row-shop",
      action: "look",
      text: {
        en: "For Cloudflare, Fastly and Google the tab shows anycast and the site that really answered, here Amsterdam, instead of the country the address is registered in.",
        ru: "Для Cloudflare, Fastly и Google вкладка показывает anycast и площадку, которая реально ответила, здесь Амстердам, а не страну, где зарегистрирован адрес.",
        uk: "Для Cloudflare, Fastly та Google вкладка показує anycast і майданчик, який справді відповів, тут Амстердам, а не країну, де зареєстровано адресу.",
      },
    },
    {
      target: "route-row-api",
      set: { routeName: "api" },
      text: {
        en: "no reuse: 14 connections to one port in under a minute, each with its own TCP and TLS handshake. Keep-alive or HTTP/2 would carry them over one.",
        ru: "no reuse: 14 соединений на один порт меньше чем за минуту, у каждого свой TCP- и TLS-хендшейк. Keep-alive или HTTP/2 пустили бы их по одному.",
        uk: "no reuse: 14 з'єднань на один порт менш ніж за хвилину, у кожного свій TCP- і TLS-гендшейк. Keep-alive або HTTP/2 пустили б їх одним.",
      },
    },
    {
      target: "routes-flagged",
      set: { routesFlagged: true, routeName: "none" },
      text: {
        en: "Flagged leaves only what looks off: far servers, connections without reuse, traffic past the VPN and plain HTTP. That list is your network bug report.",
        ru: "Flagged оставляет только подозрительное: далёкие серверы, соединения без переиспользования, трафик мимо VPN и голый HTTP. Этот список — готовый баг-репорт по сети.",
        uk: "Flagged залишає лише підозріле: далекі сервери, з'єднання без повторного використання, трафік повз VPN і голий HTTP. Цей список — готовий баг-репорт щодо мережі.",
      },
    },
  ],
} satisfies Scenario
