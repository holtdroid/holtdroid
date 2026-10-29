import type { Scenario } from "../types"

export default {
  initial: { sessions: 1, idleMinutes: 3 },
  steps: [
    {
      target: "sessions",
      action: "look",
      text: {
        en: "Active sessions on the right lists every running device: yours and your colleagues'.",
        ru: "Справа, в Active sessions, видны все запущенные устройства: ваши и коллег.",
        uk: "Праворуч, в Active sessions, видно всі запущені пристрої: ваші й колег.",
      },
    },
    {
      target: "slots",
      action: "look",
      text: {
        en: "The bar shows the device pool: green ones are free, amber ones are busy. When none is free, a new launch waits in line.",
        ru: "Полоска показывает пул устройств: зелёные свободны, жёлтые заняты. Если свободных нет, новый запуск встаёт в очередь.",
        uk: "Смужка показує пул пристроїв: зелені вільні, жовті зайняті. Якщо вільних немає, новий запуск стає в чергу.",
      },
    },
    {
      target: "idle-timer",
      action: "look",
      text: {
        en: "Each device is taken back when nobody touches it for a while, and in any case after a few hours. This line shows how much time is left.",
        ru: "Устройство забирают, если его долго никто не трогает, и в любом случае через несколько часов. Эта строка показывает, сколько осталось.",
        uk: "Пристрій забирають, якщо його довго ніхто не чіпає, і в будь-якому разі за кілька годин. Цей рядок показує, скільки лишилося.",
      },
    },
    {
      target: "session-extend",
      set: { idleMinutes: 15 },
      text: {
        en: "Going to a meeting? Press Extend: the idle countdown starts again from the top.",
        ru: "Уходите на встречу? Нажмите Extend — отсчёт простоя начнётся заново.",
        uk: "Ідете на зустріч? Натисніть Extend — відлік простою почнеться заново.",
      },
    },
    {
      target: "session-open",
      set: { page: "session" },
      text: {
        en: "Open takes you back to the device.",
        ru: "Open возвращает вас к устройству.",
        uk: "Open повертає вас до пристрою.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "Using the device counts as activity: clicks and typing on the page, changing settings. A tab that is merely open does not.",
        ru: "Активностью считается работа с устройством: клики и ввод на странице, смена настроек. Просто открытая вкладка — нет.",
        uk: "Активністю вважається робота з пристроєм: кліки та введення на сторінці, зміна налаштувань. Просто відкрита вкладка — ні.",
      },
    },
    {
      target: "session-timer",
      action: "look",
      text: {
        en: "The same countdown is in the session header, next to Extend.",
        ru: "Тот же отсчёт есть в шапке сессии, рядом с Extend.",
        uk: "Той самий відлік є в шапці сесії, поруч з Extend.",
      },
    },
    {
      target: "stop",
      set: { page: "home", sessions: 0 },
      text: {
        en: "Done testing? Press Stop. The device goes back to the pool for the next person.",
        ru: "Закончили? Нажмите Stop. Устройство вернётся в пул для следующего человека.",
        uk: "Закінчили? Натисніть Stop. Пристрій повернеться до пулу для наступної людини.",
      },
    },
    {
      target: "launch",
      action: "look",
      text: {
        en: "Your server may also limit how many devices one person runs at once. Over the limit, Launch says so; stop one of yours first.",
        ru: "Сервер может ограничивать, сколько устройств один человек держит одновременно. Если лимит исчерпан, Launch об этом скажет — сначала остановите одно из своих.",
        uk: "Сервер може обмежувати, скільки пристроїв одна людина тримає одночасно. Якщо ліміт вичерпано, Launch про це скаже — спершу зупиніть один зі своїх.",
      },
    },
  ],
} satisfies Scenario
