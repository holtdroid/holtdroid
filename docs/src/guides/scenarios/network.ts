import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-network",
      action: "click",
      set: { panel: "network" },
      text: {
        en: "Network settings live in the Network row of the Device panel. Open it.",
        ru: "Настройки сети находятся в строке Network панели Device. Откройте её.",
        uk: "Налаштування мережі містяться в рядку Network панелі Device. Відкрийте його.",
      },
    },
    {
      target: "net-conditions",
      set: { panel: "none", dialog: "network" },
      text: {
        en: "Network conditions make the connection worse on purpose: slower, with delays and lost packets, like a real mobile network. This row opens the network picker over the session.",
        ru: "Network conditions специально ухудшают связь: медленнее, с задержками и потерями пакетов, как в настоящей мобильной сети. Эта строка открывает окно выбора сети поверх сессии.",
        uk: "Network conditions навмисно погіршують зв'язок: повільніше, із затримками та втратою пакетів, як у справжній мобільній мережі. Цей рядок відкриває вікно вибору мережі поверх сесії.",
      },
    },
    {
      target: "net-hspa",
      set: { network: "hspa" },
      text: {
        en: "On the Networks tab, pick 3G. Each network shows its delay, speed and loss next to a short description.",
        ru: "На вкладке Networks выберите 3G. У каждой сети показаны задержка, скорость и потери, а рядом короткое описание.",
        uk: "На вкладці Networks оберіть 3G. Для кожної мережі показано затримку, швидкість і втрати, а поруч короткий опис.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "Now watch the app: prices load late, placeholders hang longer. Check that it shows loaders instead of a blank screen and doesn't give up too early.",
        ru: "Теперь смотрите на приложение: цены подгружаются с опозданием, заглушки висят дольше. Проверьте, что оно показывает загрузку, а не пустой экран, и не сдаётся слишком рано.",
        uk: "Тепер дивіться на застосунок: ціни підвантажуються із запізненням, заглушки висять довше. Перевірте, що він показує завантаження, а не порожній екран, і не здається надто рано.",
      },
    },
    {
      target: "net-subway",
      set: { network: "subway" },
      text: {
        en: "Scenarios change the network over time. On the Scenarios tab, Subway is 4G at stations, 3G between them and tunnels with no signal at all; its strip marks the step running now.",
        ru: "Сценарии меняют сеть со временем. На вкладке Scenarios Subway — это 4G на станциях, 3G между ними и тоннели, где связи нет совсем; полоска отмечает шаг, который идёт сейчас.",
        uk: "Сценарії змінюють мережу з часом. На вкладці Scenarios Subway — це 4G на станціях, 3G між ними та тунелі, де зв'язку немає зовсім; смужка позначає крок, що триває зараз.",
      },
    },
    {
      target: "phone-buy",
      action: "look",
      set: { dialog: "none" },
      text: {
        en: "Try to buy something while the signal drops. A good app retries or explains what happened; a bad one charges twice or freezes.",
        ru: "Попробуйте что-нибудь купить, пока связь пропадает. Хорошее приложение повторит запрос или объяснит, что случилось; плохое спишет деньги дважды или зависнет.",
        uk: "Спробуйте щось купити, поки зв'язок зникає. Добрий застосунок повторить запит або пояснить, що сталося; поганий спише гроші двічі або зависне.",
      },
    },
    {
      target: "w-network",
      action: "click",
      set: { panel: "network" },
      text: {
        en: "Back in the Network row, the tiles switch the connections themselves.",
        ru: "В строке Network плитки включают и выключают сами подключения.",
        uk: "У рядку Network плитки вмикають та вимикають самі підключення.",
      },
    },
    {
      target: "airplane",
      action: "look",
      set: { panel: "none", dialog: "network" },
      text: {
        en: "Airplane mode, Wi-Fi and Mobile data switch the network off completely, so Android itself says there is no connection.",
        ru: "Airplane mode, Wi-Fi и Mobile data выключают сеть полностью: тогда и сам Android сообщает, что подключения нет.",
        uk: "Airplane mode, Wi-Fi і Mobile data вимикають мережу повністю: тоді й сам Android повідомляє, що підключення немає.",
      },
    },
    {
      target: "net-full",
      set: { network: "full", dialog: "network" },
      text: {
        en: "No emulation in the picker's header brings the normal connection back. Until then the Network row stays marked as changed, so you won't forget it's on.",
        ru: "No emulation в заголовке окна возвращает обычную связь. До этого строка Network остаётся помеченной как изменённая, чтобы вы не забыли, что ограничение включено.",
        uk: "No emulation у заголовку вікна повертає звичайний зв'язок. До того рядок Network лишається позначеним як змінений, щоб ви не забули, що обмеження ввімкнено.",
      },
    },
  ],
} satisfies Scenario
