import type { Scenario } from "../types"

export default {
  steps: [
    {
      target: "launch",
      set: { dialog: "launch" },
      text: {
        en: "The WebView version is chosen at launch. Press Launch on the app.",
        ru: "Версия WebView выбирается при запуске. Нажмите Launch на приложении.",
        uk: "Версія WebView обирається під час запуску. Натисніть Launch на застосунку.",
      },
    },
    {
      target: "launch-continue",
      set: { launchStage: "options" },
      text: {
        en: "WebView choices exist only for a virtual device. Keep Virtual device and press Continue.",
        ru: "Выбор WebView есть только у виртуального устройства. Оставьте Virtual device и нажмите Continue.",
        uk: "Вибір WebView є лише у віртуального пристрою. Залиште Virtual device і натисніть Continue.",
      },
    },
    {
      target: "android-14",
      set: { android: "14" },
      text: {
        en: "Pick the Android version first: the list of WebViews shows only builds that work on it.",
        ru: "Сначала выберите версию Android: в списке WebView останутся только сборки, которые на ней работают.",
        uk: "Спочатку оберіть версію Android: у списку WebView залишаться лише збірки, що на ній працюють.",
      },
    },
    {
      target: "webview",
      action: "look",
      text: {
        en: "WebView is the engine that draws web pages inside apps. Many bugs depend on its version, not on Android's. The newest stable Chromium is preselected.",
        ru: "WebView — движок, который рисует веб-страницы внутри приложений. Многие баги зависят от его версии, а не от версии Android. По умолчанию выбран свежий стабильный Chromium.",
        uk: "WebView — рушій, який малює вебсторінки всередині застосунків. Багато багів залежать від його версії, а не від версії Android. Типово обрано свіжий стабільний Chromium.",
      },
    },
    {
      target: "webview",
      action: "look",
      set: { webview: "builtin" },
      text: {
        en: "A user on an old phone? Pick Built-in: the WebView that came with this Android image, never updated. Beta shows what users get in a few weeks.",
        ru: "Пользователь со старым телефоном? Выберите Built-in — WebView, который шёл с этой версией Android и ни разу не обновлялся. Beta покажет то, что пользователи получат через несколько недель.",
        uk: "Користувач зі старим телефоном? Оберіть Built-in — WebView, що постачався з цією версією Android і жодного разу не оновлювався. Beta покаже те, що користувачі отримають за кілька тижнів.",
      },
    },
    {
      target: "launch-submit",
      set: { dialog: "none", page: "session", start: "installing", sessions: 1 },
      text: {
        en: "Press Launch. A chosen Chromium build is installed before the app starts, which adds a few seconds.",
        ru: "Нажмите Launch. Выбранная сборка Chromium ставится до запуска приложения, это добавляет несколько секунд.",
        uk: "Натисніть Launch. Обрана збірка Chromium встановлюється до запуску застосунку, це додає кілька секунд.",
      },
    },
    {
      target: "start-progress",
      action: "look",
      set: { start: "ready" },
      text: {
        en: "The progress shows each stage. With a Chromium build there is an extra one: Installing WebView and the APK.",
        ru: "Прогресс показывает каждый этап. Со сборкой Chromium появляется ещё один: Installing WebView and the APK.",
        uk: "Прогрес показує кожен етап. Зі збіркою Chromium з'являється ще один: Installing WebView and the APK.",
      },
    },
    {
      target: "w-device",
      set: { panel: "device" },
      text: {
        en: "The WebView can also be switched during the session. Hover the Device card.",
        ru: "WebView можно сменить и во время сессии. Наведите курсор на карточку Device.",
        uk: "WebView можна змінити й під час сесії. Наведіть курсор на картку Device.",
      },
    },
    {
      target: "webview-stable",
      set: { webview: "stable" },
      text: {
        en: "Under WebView provider, pick another one. Apps load it after they restart, so restart the app afterwards.",
        ru: "В разделе WebView provider выберите другой. Приложения подхватывают его после перезапуска, так что потом перезапустите приложение.",
        uk: "У розділі WebView provider оберіть інший. Застосунки підхоплюють його після перезапуску, тож потім перезапустіть застосунок.",
      },
    },
    {
      target: "version-switcher",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "The session header shows which WebView is in use. To compare two versions side by side, start one session for each.",
        ru: "В шапке сессии видно, какой WebView сейчас используется. Чтобы сравнить две версии рядом, запустите по сессии на каждую.",
        uk: "У шапці сесії видно, який WebView зараз використовується. Щоб порівняти дві версії поруч, запустіть по сесії на кожну.",
      },
    },
  ],
} satisfies Scenario
