import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "tab-files",
      set: { tab: "files" },
      text: {
        en: "Open the Files tab next to DevTools. It's a file manager for the device, right in the browser.",
        ru: "Откройте вкладку Files рядом с DevTools. Это файловый менеджер устройства прямо в браузере.",
        uk: "Відкрийте вкладку Files поруч із DevTools. Це файловий менеджер пристрою просто в браузері.",
      },
    },
    {
      target: "files-list",
      action: "look",
      text: {
        en: "App data is the app's private folder: settings, databases, the WebView's cookies and storage. On a normal phone you can't see it.",
        ru: "App data — приватная папка приложения: настройки, базы данных, cookies и хранилище WebView. На обычном телефоне её не увидеть.",
        uk: "App data — приватна тека застосунку: налаштування, бази даних, cookies і сховище WebView. На звичайному телефоні її не побачити.",
      },
    },
    {
      target: "file-shared_prefs",
      set: { filesFolder: "shared_prefs" },
      text: {
        en: "shared_prefs holds the app's settings as small XML files.",
        ru: "В shared_prefs лежат настройки приложения в виде небольших XML-файлов.",
        uk: "У shared_prefs лежать налаштування застосунку у вигляді невеликих XML-файлів.",
      },
    },
    {
      target: "file-session.xml",
      action: "look",
      text: {
        en: "Download one to check what the app really saved, for example whether a flag was set after onboarding.",
        ru: "Скачайте файл, чтобы проверить, что приложение на самом деле сохранило, например выставился ли флаг после онбординга.",
        uk: "Завантажте файл, щоб перевірити, що застосунок насправді зберіг, наприклад чи встановився прапорець після онбордингу.",
      },
    },
    {
      target: "files-shared",
      set: { filesRoot: "shared", filesFolder: "" },
      text: {
        en: "Shared storage is what other apps and the file picker see: Downloads, Pictures, DCIM.",
        ru: "Shared storage — то, что видят другие приложения и окно выбора файла: Downloads, Pictures, DCIM.",
        uk: "Shared storage — те, що бачать інші застосунки й вікно вибору файлу: Downloads, Pictures, DCIM.",
      },
    },
    {
      target: "file-Download",
      set: { filesFolder: "Download" },
      text: {
        en: "Open Download.",
        ru: "Откройте Download.",
        uk: "Відкрийте Download.",
      },
    },
    {
      target: "files-upload",
      set: { fileUploaded: true },
      text: {
        en: "Upload a file from your computer, or just drop it onto the list.",
        ru: "Загрузите файл с компьютера или просто перетащите его в список.",
        uk: "Завантажте файл із комп'ютера або просто перетягніть його до списку.",
      },
    },
    {
      target: "file-receipt-test.pdf",
      action: "look",
      text: {
        en: "It's on the device now. Pick it in the app's file picker to test an upload form.",
        ru: "Файл уже на устройстве. Выберите его в приложении через окно выбора файла, чтобы проверить форму загрузки.",
        uk: "Файл уже на пристрої. Оберіть його в застосунку через вікно вибору файлу, щоб перевірити форму завантаження.",
      },
    },
  ],
} satisfies Scenario
