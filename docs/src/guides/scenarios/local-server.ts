import type { Scenario } from "../types"

export default {
  initial: { page: "computers", sessions: 1, computerOnline: true, terminal: 4 },
  steps: [
    {
      target: "terminal",
      action: "look",
      set: { terminal: 6 },
      text: {
        en: "Start your dev server on your computer as usual, for example Vite on port 5173.",
        ru: "Запустите dev-сервер на своём компьютере как обычно, например Vite на порту 5173.",
        uk: "Запустіть dev-сервер на своєму комп'ютері як зазвичай, наприклад Vite на порту 5173.",
      },
    },
    {
      target: "port-5173",
      action: "look",
      text: {
        en: "The connected holtdroid client notices the new port, and the Computers page shows it.",
        ru: "Подключённый клиент holtdroid замечает новый порт, и он появляется на странице Computers.",
        uk: "Підключений клієнт holtdroid помічає новий порт, і він з'являється на сторінці Computers.",
      },
    },
    {
      target: "port-5173",
      set: { portPublished: true },
      text: {
        en: "Click the port to publish it on your devices. In the default Dev servers mode the client does this by itself for programs like node or vite.",
        ru: "Кликните по порту, чтобы опубликовать его на своих устройствах. В режиме Dev servers (он по умолчанию) клиент делает это сам для программ вроде node или vite.",
        uk: "Клацніть по порту, щоб опублікувати його на своїх пристроях. У режимі Dev servers (він типовий) клієнт робить це сам для програм на кшталт node чи vite.",
      },
    },
    {
      target: "nav-apps",
      set: { page: "home" },
      text: {
        en: "Go back to your running device.",
        ru: "Вернитесь к запущенному устройству.",
        uk: "Поверніться до запущеного пристрою.",
      },
    },
    {
      target: "session-open",
      set: { page: "session" },
      text: {
        en: "Open its session.",
        ru: "Откройте его сессию.",
        uk: "Відкрийте його сесію.",
      },
    },
    {
      target: "w-ssh",
      action: "hover",
      set: { panel: "ssh" },
      text: {
        en: "The SSH card shows what your computer gives this device: ADB and the published ports.",
        ru: "Карточка SSH показывает, что ваш компьютер отдаёт этому устройству: ADB и опубликованные порты.",
        uk: "Картка SSH показує, що ваш комп'ютер віддає цьому пристрою: ADB і опубліковані порти.",
      },
    },
    {
      target: "ssh-port-5173",
      action: "look",
      text: {
        en: "Port 5173 is published: on the device it is localhost:5173, just like on your laptop.",
        ru: "Порт 5173 опубликован: на устройстве это localhost:5173, ровно как на вашем ноутбуке.",
        uk: "Порт 5173 опубліковано: на пристрої це localhost:5173, так само як на вашому ноутбуці.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none", phoneUrl: "dev" },
      text: {
        en: "Open http://localhost:5173 on the phone, or point your app's WebView at it: the page comes from your computer, with hot reload.",
        ru: "Откройте на телефоне http://localhost:5173 или направьте туда WebView приложения: страница приходит с вашего компьютера, с горячей перезагрузкой.",
        uk: "Відкрийте на телефоні http://localhost:5173 або спрямуйте туди WebView застосунку: сторінка приходить з вашого комп'ютера, з гарячим перезавантаженням.",
      },
    },
  ],
} satisfies Scenario
