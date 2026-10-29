import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-app",
      action: "hover",
      set: { panel: "app" },
      text: {
        en: "Hover the App card. Everything you'd normally do with adb commands is here as buttons.",
        ru: "Наведите курсор на карточку App. Всё, что обычно делают командами adb, здесь собрано в кнопки.",
        uk: "Наведіть курсор на картку App. Усе, що зазвичай роблять командами adb, тут зібрано в кнопки.",
      },
    },
    {
      target: "deeplink",
      type: { key: "deeplink", value: "pinecone://product/cedar-cone" },
      text: {
        en: "A deep link is an address that opens a specific screen inside the app. Type one, like the links in your push notifications or emails.",
        ru: "Диплинк — это адрес, который открывает конкретный экран внутри приложения. Введите его, например такой же, как в пуш-уведомлении или письме.",
        uk: "Діплінк — це адреса, що відкриває конкретний екран усередині застосунку. Введіть її, наприклад таку саму, як у пуш-сповіщенні чи листі.",
      },
    },
    {
      target: "deeplink-open",
      text: {
        en: "Open sends it to the device, as if the user tapped the link. Links you opened are remembered in your browser for next time.",
        ru: "Open отправляет ссылку на устройство, как будто пользователь по ней нажал. Открытые ссылки запоминаются в вашем браузере на следующий раз.",
        uk: "Open надсилає посилання на пристрій, ніби користувач на нього натиснув. Відкриті посилання запам'ятовуються у вашому браузері на наступний раз.",
      },
    },
    {
      target: "perm-camera",
      set: { cameraGranted: true },
      text: {
        en: "Permissions: click one to grant it without going through the system dialog.",
        ru: "Разрешения: нажмите на нужное, чтобы выдать его без системного диалога.",
        uk: "Дозволи: натисніть на потрібний, щоб надати його без системного діалогу.",
      },
    },
    {
      target: "perm-notifications",
      set: { notificationsGranted: false },
      text: {
        en: "Click again to revoke. Handy to check what the app does when the user said “no”.",
        ru: "Повторный клик отзывает разрешение. Удобно проверить, что делает приложение, если пользователь ответил «нет».",
        uk: "Повторний клік відкликає дозвіл. Зручно перевірити, що робить застосунок, якщо користувач відповів «ні».",
      },
    },
    {
      target: "app-stop",
      set: { appRunning: false },
      text: {
        en: "Force stop kills the app, like swiping it away and more. The device stays on.",
        ru: "Force stop принудительно завершает приложение, жёстче, чем смахнуть его из списка. Устройство при этом продолжает работать.",
        uk: "Force stop примусово завершує застосунок, жорсткіше, ніж змахнути його зі списку. Пристрій при цьому працює далі.",
      },
    },
    {
      target: "app-restart",
      set: { appRunning: true },
      text: {
        en: "Restart app starts it again, from a cold start.",
        ru: "Restart app запускает его снова, с холодного старта.",
        uk: "Restart app запускає його знову, з холодного старту.",
      },
    },
    {
      target: "app-clear",
      set: { dataCleared: true },
      text: {
        en: "Clear data wipes everything the app stored, as after a fresh install, without reinstalling.",
        ru: "Clear data стирает всё, что приложение сохранило, как после новой установки, но без переустановки.",
        uk: "Clear data стирає все, що застосунок зберіг, як після нового встановлення, але без перевстановлення.",
      },
    },
    {
      target: "phone",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "The app is back on its welcome screen. Now you can test onboarding again in seconds.",
        ru: "Приложение снова на приветственном экране. Онбординг можно проверить ещё раз за секунды.",
        uk: "Застосунок знову на вітальному екрані. Онбординг можна перевірити ще раз за лічені секунди.",
      },
    },
  ],
} satisfies Scenario
