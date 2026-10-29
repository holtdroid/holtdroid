import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-network",
      action: "hover",
      set: { panel: "network" },
      text: {
        en: "Network settings live in the Network card. Hover it to open the panel.",
        ru: "Настройки сети находятся в карточке Network. Наведите на неё курсор, чтобы открыть панель.",
        uk: "Налаштування мережі містяться в картці Network. Наведіть на неї курсор, щоб відкрити панель.",
      },
    },
    {
      target: "net-conditions",
      set: { panel: "none", tab: "network" },
      text: {
        en: "Network conditions make the connection worse on purpose: slower, with delays and lost packets, like a real mobile network. The row opens the Network tab next to DevTools.",
        ru: "Network conditions специально ухудшают связь: медленнее, с задержками и потерями пакетов, как в настоящей мобильной сети. Эта строка открывает вкладку Network рядом с DevTools.",
        uk: "Network conditions навмисно погіршують зв'язок: повільніше, із затримками та втратою пакетів, як у справжній мобільній мережі. Цей рядок відкриває вкладку Network поруч із DevTools.",
      },
    },
    {
      target: "net-hspa",
      set: { network: "hspa" },
      text: {
        en: "Pick 3G. Each network shows its delay, speed and loss next to a short description.",
        ru: "Выберите 3G. У каждой сети показаны задержка, скорость и потери, а рядом короткое описание.",
        uk: "Оберіть 3G. Для кожної мережі показано затримку, швидкість і втрати, а поруч короткий опис.",
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
        en: "Scenarios change the network over time. Subway is 4G at stations, 3G between them and tunnels with no signal at all.",
        ru: "Сценарии меняют сеть со временем. Subway — это 4G на станциях, 3G между ними и тоннели, где связи нет совсем.",
        uk: "Сценарії змінюють мережу з часом. Subway — це 4G на станціях, 3G між ними та тунелі, де зв'язку немає зовсім.",
      },
    },
    {
      target: "phone-buy",
      action: "look",
      text: {
        en: "Try to buy something while the signal drops. A good app retries or explains what happened; a bad one charges twice or freezes.",
        ru: "Попробуйте что-нибудь купить, пока связь пропадает. Хорошее приложение повторит запрос или объяснит, что случилось; плохое спишет деньги дважды или зависнет.",
        uk: "Спробуйте щось купити, поки зв'язок зникає. Добрий застосунок повторить запит або пояснить, що сталося; поганий спише гроші двічі або зависне.",
      },
    },
    {
      target: "w-network",
      action: "hover",
      set: { panel: "network" },
      text: {
        en: "Back in the Network card, the bottom row of tiles switches the connections themselves.",
        ru: "В карточке Network нижний ряд плиток включает и выключает сами подключения.",
        uk: "У картці Network нижній ряд плиток вмикає та вимикає самі підключення.",
      },
    },
    {
      target: "airplane",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "Airplane mode, Wi-Fi and Mobile data switch the network off completely, so Android itself says there is no connection.",
        ru: "Airplane mode, Wi-Fi и Mobile data выключают сеть полностью: тогда и сам Android сообщает, что подключения нет.",
        uk: "Airplane mode, Wi-Fi і Mobile data вимикають мережу повністю: тоді й сам Android повідомляє, що підключення немає.",
      },
    },
    {
      target: "net-full",
      set: { network: "full" },
      text: {
        en: "No emulation in the Network tab brings the normal connection back. Until then the Network card stays marked, so you won't forget it's on.",
        ru: "No emulation на вкладке Network возвращает обычную связь. До этого карточка Network остаётся помеченной, чтобы вы не забыли, что ограничение включено.",
        uk: "No emulation на вкладці Network повертає звичайний зв'язок. До того картка Network лишається позначеною, щоб ви не забули, що обмеження ввімкнено.",
      },
    },
  ],
} satisfies Scenario
