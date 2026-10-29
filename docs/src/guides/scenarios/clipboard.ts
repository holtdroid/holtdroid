import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-clipboard",
      action: "look",
      text: {
        en: "The Clipboard card connects your computer's clipboard with the device's. A click on the card turns sync on or off.",
        ru: "Карточка Clipboard связывает буфер обмена вашего компьютера с буфером устройства. Клик по карточке включает или выключает синхронизацию.",
        uk: "Картка Clipboard поєднує буфер обміну вашого комп'ютера з буфером пристрою. Клік по картці вмикає або вимикає синхронізацію.",
      },
    },
    {
      target: "w-clipboard",
      action: "hover",
      set: { panel: "clipboard" },
      text: {
        en: "Hover the card to choose the direction.",
        ru: "Наведите курсор на карточку, чтобы выбрать направление.",
        uk: "Наведіть курсор на картку, щоб обрати напрямок.",
      },
    },
    {
      target: "clip-both",
      action: "look",
      text: {
        en: "Both ways: copy on either side, paste on the other. This is the default.",
        ru: "Both ways: копируете с одной стороны, вставляете на другой. Это режим по умолчанию.",
        uk: "Both ways: копіюєте з одного боку, вставляєте з іншого. Це типовий режим.",
      },
    },
    {
      target: "clip-to",
      action: "look",
      text: {
        en: "To the device only sends what you copy on the computer, so the device can't overwrite your clipboard.",
        ru: "To the device только отправляет то, что вы копируете на компьютере: устройство не перезапишет ваш буфер.",
        uk: "To the device лише надсилає те, що ви копіюєте на комп'ютері: пристрій не перезапише ваш буфер.",
      },
    },
    {
      target: "clip-from",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "From the device does the opposite: what the app copies, like a promo code or a link, lands in your clipboard.",
        ru: "From the device работает наоборот: то, что копирует приложение, например промокод или ссылка, попадает в ваш буфер.",
        uk: "From the device працює навпаки: те, що копіює застосунок, наприклад промокод чи посилання, потрапляє у ваш буфер.",
      },
    },
    {
      target: "phone-search",
      type: { key: "phoneText", value: "PROMO-AUTUMN-2026" },
      text: {
        en: "Copy a long test value on your computer, tap a field on the phone and press Ctrl+V or Cmd+V. No retyping long codes by hand.",
        ru: "Скопируйте длинное тестовое значение на компьютере, тапните по полю в телефоне и нажмите Ctrl+V или Cmd+V. Длинные коды больше не нужно перепечатывать.",
        uk: "Скопіюйте довге тестове значення на комп'ютері, тапніть по полю в телефоні й натисніть Ctrl+V або Cmd+V. Довгі коди більше не треба передруковувати.",
      },
    },
    {
      target: "w-clipboard",
      action: "look",
      text: {
        en: "Ctrl+V or Cmd+V on the screen always pastes, even with sync off. Sync matters for the other direction and for the app's own paste button.",
        ru: "Ctrl+V или Cmd+V на экране вставляет всегда, даже с выключенной синхронизацией. Синхронизация нужна для обратного направления и для кнопки «Вставить» в самом приложении.",
        uk: "Ctrl+V або Cmd+V на екрані вставляє завжди, навіть із вимкненою синхронізацією. Синхронізація потрібна для зворотного напрямку та для кнопки «Вставити» в самому застосунку.",
      },
    },
  ],
} satisfies Scenario
