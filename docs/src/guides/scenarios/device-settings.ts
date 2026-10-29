import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-display",
      action: "hover",
      set: { panel: "display" },
      text: {
        en: "Display settings are in the Display card: brightness, font size and the theme.",
        ru: "Настройки экрана — в карточке Display: яркость, размер шрифта и тема.",
        uk: "Налаштування екрана — у картці Display: яскравість, розмір шрифту й тема.",
      },
    },
    {
      target: "display-dark",
      set: { dark: true },
      text: {
        en: "Turn on Dark theme. Apps that follow the system theme switch right away.",
        ru: "Включите Dark theme. Приложения, которые следуют системной теме, переключатся сразу.",
        uk: "Увімкніть Dark theme. Застосунки, що слідують системній темі, перемкнуться одразу.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "Look for text that disappears on a dark background, white images with hard edges and colours that were hard-coded.",
        ru: "Ищите текст, который пропадает на тёмном фоне, белые картинки с резкими краями и цвета, зашитые в код.",
        uk: "Шукайте текст, що зникає на темному тлі, білі картинки з різкими краями та кольори, зашиті в код.",
      },
    },
    {
      target: "w-language",
      action: "hover",
      set: { panel: "language" },
      text: {
        en: "The Language card sets the system language and the keyboard layouts.",
        ru: "Карточка Language задаёт язык системы и раскладки клавиатуры.",
        uk: "Картка Language задає мову системи та розкладки клавіатури.",
      },
    },
    {
      target: "lang-uk",
      set: { locale: "uk" },
      text: {
        en: "Pick a language. Android switches without a reboot, and the app is shown in that language.",
        ru: "Выберите язык. Android переключается без перезагрузки, и приложение показывается на этом языке.",
        uk: "Оберіть мову. Android перемикається без перезавантаження, і застосунок показується цією мовою.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "Check for missing translations, cut-off long words and dates in the wrong format. German is good for long words.",
        ru: "Проверьте, нет ли непереведённых строк, обрезанных длинных слов и дат в неправильном формате. Для длинных слов хорош немецкий.",
        uk: "Перевірте, чи немає неперекладених рядків, обрізаних довгих слів і дат у неправильному форматі. Для довгих слів добра німецька.",
      },
    },
    {
      target: "w-time",
      action: "hover",
      set: { panel: "time" },
      text: {
        en: "The Date and time card changes the time zone, and on real phones the clock itself.",
        ru: "Карточка Date and time меняет часовой пояс, а на настоящих телефонах и сами часы.",
        uk: "Картка Date and time змінює часовий пояс, а на справжніх телефонах і сам годинник.",
      },
    },
    {
      target: "tz-almaty",
      set: { timeZone: "almaty" },
      text: {
        en: "A virtual device shares the server's clock, so pick a time zone instead: the phone's clock jumps to Almaty time. Check that “today”, delivery slots and dates follow it. On a real phone the clock itself can be moved too, to test an expiring promo.",
        ru: "Виртуальное устройство живёт по часам сервера, поэтому здесь выбирается часовой пояс: часы телефона переходят на время Алматы. Проверьте, что «сегодня», слоты доставки и даты подстраиваются. На настоящем телефоне можно сдвинуть и сами часы, чтобы проверить истекающую акцию.",
        uk: "Віртуальний пристрій живе за годинником сервера, тому тут обирається часовий пояс: годинник телефона переходить на час Алмати. Перевірте, що «сьогодні», слоти доставки й дати підлаштовуються. На справжньому телефоні можна зсунути й сам годинник, щоб перевірити акцію, що спливає.",
      },
    },
    {
      target: "w-battery",
      action: "hover",
      set: { panel: "battery" },
      text: {
        en: "The Battery card pretends the battery is low, charging or in saver mode.",
        ru: "Карточка Battery изображает разряженную батарею, зарядку или режим экономии.",
        uk: "Картка Battery імітує розряджену батарею, заряджання або режим економії.",
      },
    },
    {
      target: "battery-presets",
      set: { battery: 5 },
      text: {
        en: "Pick 5%. Android shows the low battery warning over the app, the way users see it.",
        ru: "Выберите 5%. Android показывает предупреждение о низком заряде поверх приложения, как это видят пользователи.",
        uk: "Оберіть 5%. Android показує попередження про низький заряд поверх застосунку, як це бачать користувачі.",
      },
    },
    {
      target: "battery-saver",
      set: { saver: true },
      text: {
        en: "Battery saver limits background work and animations. Check that sync and notifications still arrive.",
        ru: "Battery saver ограничивает фоновую работу и анимации. Проверьте, что синхронизация и уведомления всё равно приходят.",
        uk: "Battery saver обмежує фонову роботу й анімації. Перевірте, що синхронізація та сповіщення все одно надходять.",
      },
    },
    {
      target: "widgets",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "Every changed card gets an amber dot, so you can see at a glance what differs from a normal phone.",
        ru: "У каждой изменённой карточки появляется жёлтая точка: сразу видно, чем устройство отличается от обычного телефона.",
        uk: "У кожної зміненої картки з'являється жовта крапка: одразу видно, чим пристрій відрізняється від звичайного телефона.",
      },
    },
  ],
} satisfies Scenario
