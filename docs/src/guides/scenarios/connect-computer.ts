import type { Scenario } from "../types"

export default {
  initial: { sessions: 1 },
  steps: [
    {
      target: "nav-computers",
      set: { page: "computers" },
      text: {
        en: "Open Computers: the laptop button in the header.",
        ru: "Откройте Computers — кнопка с ноутбуком в шапке.",
        uk: "Відкрийте Computers — кнопка з ноутбуком у шапці.",
      },
    },
    {
      target: "connect-card",
      action: "look",
      text: {
        en: "The portal gives you a command for your terminal. It works once and only for ten minutes.",
        ru: "Портал даёт команду для терминала. Она срабатывает один раз и только в течение десяти минут.",
        uk: "Портал дає команду для термінала. Вона спрацьовує один раз і лише протягом десяти хвилин.",
      },
    },
    {
      target: "connect-copy",
      set: { toast: "copied" },
      text: {
        en: "Copy the command.",
        ru: "Скопируйте команду.",
        uk: "Скопіюйте команду.",
      },
    },
    {
      target: "terminal",
      action: "look",
      set: { terminal: 1, toast: "none" },
      text: {
        en: "Paste it into a terminal on your Mac or Linux machine and press Enter.",
        ru: "Вставьте её в терминал на Mac или Linux и нажмите Enter.",
        uk: "Вставте її в термінал на Mac або Linux і натисніть Enter.",
      },
    },
    {
      target: "terminal",
      action: "look",
      set: { terminal: 2, computerOnline: true },
      text: {
        en: "The script downloads the holtdroid client, checks it and connects. No SSH keys to set up.",
        ru: "Скрипт скачивает клиент holtdroid, проверяет его и подключается. Настраивать SSH-ключи не нужно.",
        uk: "Скрипт завантажує клієнт holtdroid, перевіряє його і підключається. Налаштовувати SSH-ключі не потрібно.",
      },
    },
    {
      target: "computer-card",
      action: "look",
      text: {
        en: "Your computer appears on the page as online, with the address of each running device's ADB.",
        ru: "Ваш компьютер появляется на странице как online, вместе с ADB-адресом каждого запущенного устройства.",
        uk: "Ваш комп'ютер з'являється на сторінці як online, разом з ADB-адресою кожного запущеного пристрою.",
      },
    },
    {
      target: "terminal",
      action: "look",
      set: { terminal: 4 },
      text: {
        en: "If adb is installed, the device is already there: adb devices lists it, and Android Studio sees it too.",
        ru: "Если adb установлен, устройство уже подключено: adb devices его показывает, и Android Studio тоже его видит.",
        uk: "Якщо adb встановлено, пристрій уже підключено: adb devices його показує, і Android Studio теж його бачить.",
      },
    },
    {
      target: "nav-computers",
      action: "look",
      text: {
        en: "The green number on the laptop button shows how many of your computers are connected right now.",
        ru: "Зелёная цифра на кнопке с ноутбуком показывает, сколько ваших компьютеров подключено прямо сейчас.",
        uk: "Зелена цифра на кнопці з ноутбуком показує, скільки ваших комп'ютерів підключено просто зараз.",
      },
    },
  ],
} satisfies Scenario
