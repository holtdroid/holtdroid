import type { Scenario } from "../types"

export default {
  initial: { sessions: 1, idleMinutes: 3 },
  steps: [
    {
      target: "sessions",
      action: "look",
      text: {
        en: "The Devices card on the right lists every running device: yours first, then your colleagues'.",
        ru: "Справа, в карточке Devices, видны все запущенные устройства: сначала ваши, потом коллег.",
        uk: "Праворуч, у картці Devices, видно всі запущені пристрої: спершу ваші, потім колег.",
      },
    },
    {
      target: "slots",
      action: "look",
      text: {
        en: "The bar shows the device pool, one tick per device: green ones run, blue ones are starting, amber ones are about to stop, grey ones are free. When none is free, a new launch waits in line.",
        ru: "Полоска показывает пул устройств, по черточке на каждое: зелёные работают, синие запускаются, жёлтые скоро остановятся, серые свободны. Если свободных нет, новый запуск встаёт в очередь.",
        uk: "Смужка показує пул пристроїв, по рисці на кожен: зелені працюють, сині запускаються, жовті скоро зупиняться, сірі вільні. Якщо вільних немає, новий запуск стає в чергу.",
      },
    },
    {
      target: "idle-timer",
      action: "look",
      text: {
        en: "Each device is taken back when nobody touches it for a while, and in any case after a few hours. In the last minutes the badge turns amber and counts down.",
        ru: "Устройство забирают, если его долго никто не трогает, и в любом случае через несколько часов. В последние минуты значок становится жёлтым и показывает обратный отсчёт.",
        uk: "Пристрій забирають, якщо його довго ніхто не чіпає, і в будь-якому разі за кілька годин. В останні хвилини значок стає жовтим і показує зворотний відлік.",
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
