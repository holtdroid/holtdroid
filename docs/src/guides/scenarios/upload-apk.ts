import type { Scenario } from "../types"

export default {
  steps: [
    {
      target: "upload",
      set: { dialog: "upload" },
      text: {
        en: "Got an APK that isn't in the list yet, say a build from your own machine? Press Upload.",
        ru: "Есть APK, которого ещё нет в списке, например сборка с вашего компьютера? Нажмите Upload.",
        uk: "Є APK, якого ще немає в списку, наприклад збірка з вашого комп'ютера? Натисніть Upload.",
      },
    },
    {
      target: "upload-drop",
      set: { uploadFile: true },
      text: {
        en: "Drop the .apk file here or click to choose it. You can also drop it straight onto the list of apps.",
        ru: "Перетащите сюда файл .apk или кликните, чтобы выбрать его. Можно бросить файл и прямо на список приложений.",
        uk: "Перетягніть сюди файл .apk або клацніть, щоб обрати його. Можна кинути файл і просто на список застосунків.",
      },
    },
    {
      target: "upload-visibility",
      action: "look",
      text: {
        en: "Who can see it: Everyone, or Only me. A private build is visible only to you and the admins.",
        ru: "Кто увидит: Everyone — все, Only me — только вы. Приватную сборку видите только вы и администраторы.",
        uk: "Хто побачить: Everyone — усі, Only me — лише ви. Приватну збірку бачите тільки ви та адміністратори.",
      },
    },
    {
      target: "upload-temporary",
      action: "look",
      text: {
        en: "Temporary is on by default: the build deletes itself after a while without launches. Untick it for a build you want to keep.",
        ru: "Temporary включено по умолчанию: сборка сама удалится, если её долго не запускать. Снимите галочку, если сборку нужно сохранить.",
        uk: "Temporary увімкнено типово: збірка сама видалиться, якщо її довго не запускати. Зніміть позначку, якщо збірку треба зберегти.",
      },
    },
    {
      target: "upload-note",
      type: { key: "uploadNote", value: "New checkout, please test payments" },
      text: {
        en: "Add a note so others know what this build is for. A changelog fits in the field below.",
        ru: "Добавьте заметку, чтобы другие понимали, зачем эта сборка. Список изменений можно вписать в поле ниже.",
        uk: "Додайте нотатку, щоб інші розуміли, навіщо ця збірка. Список змін можна вписати в поле нижче.",
      },
    },
    {
      target: "upload-submit",
      set: { uploadProgress: 60 },
      text: {
        en: "Press Upload and wait for the bar to fill.",
        ru: "Нажмите Upload и дождитесь, пока заполнится полоска.",
        uk: "Натисніть Upload і дочекайтеся, поки заповниться смужка.",
      },
    },
    {
      target: "app-card",
      action: "look",
      set: { dialog: "none", uploadProgress: 0, uploaded: true, toast: "uploaded" },
      text: {
        en: "Done: the build joins its app's card as the newest one. Holtdroid reads the package name and version from the APK itself.",
        ru: "Готово: сборка появляется в карточке своего приложения как самая свежая. Название пакета и версию Holtdroid читает из самого APK.",
        uk: "Готово: збірка з'являється в картці свого застосунку як найсвіжіша. Назву пакета й версію Holtdroid читає із самого APK.",
      },
    },
    {
      target: "launch",
      set: { toast: "none", dialog: "launch" },
      text: {
        en: "Right after the upload the launch dialog opens, so you can try the build straight away.",
        ru: "Сразу после загрузки открывается окно запуска: сборку можно сразу попробовать.",
        uk: "Одразу після завантаження відкривається вікно запуску: збірку можна одразу спробувати.",
      },
    },
  ],
} satisfies Scenario
