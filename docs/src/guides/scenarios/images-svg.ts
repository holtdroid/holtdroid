import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, tab: "devtools" },
  steps: [
    {
      target: "tab-images",
      set: { tab: "images" },
      text: {
        en: "Open Images next to DevTools. It lists what is wrong with the images the app's WebViews load, with the bytes each fix would save.",
        ru: "Откройте Images рядом с DevTools. Здесь собрано всё, что не так с картинками в WebView приложения, и сколько байт сэкономит каждое исправление.",
        uk: "Відкрийте Images поруч із DevTools. Тут зібрано все, що не так із картинками у WebView застосунку, і скільки байтів заощадить кожне виправлення.",
      },
    },
    {
      target: "img-scan-on",
      set: { imgScan: true },
      text: {
        en: "Without the image scan only the files are checked. Turn it on so the tab also sees where the pages draw each image and how big.",
        ru: "Без сканирования картинок проверяются только сами файлы. Включите его, чтобы вкладка видела, где и какого размера страница рисует каждую картинку.",
        uk: "Без сканування картинок перевіряються лише самі файли. Увімкніть його, щоб вкладка бачила, де й якого розміру сторінка малює кожну картинку.",
      },
    },
    {
      target: "img-stats",
      action: "look",
      text: {
        en: "The numbers on top: 3.4 MB downloaded, 1.1 MB of it never shown on screen, and 2.2 MB that smaller or lazier images would save.",
        ru: "Цифры сверху: скачано 3,4 МБ, из них 1,1 МБ так и не появились на экране, а 2,2 МБ сэкономили бы картинки поменьше или загруженные позже.",
        uk: "Цифри вгорі: завантажено 3,4 МБ, із них 1,1 МБ так і не з'явилися на екрані, а 2,2 МБ заощадили б менші або пізніше завантажені картинки.",
      },
    },
    {
      target: "img-finding-banner",
      set: { imgFinding: "banner" },
      text: {
        en: 'This banner loaded with the first screen but sits 2400 px below the fold. loading="lazy" would fetch it only when the user scrolls there.',
        ru: 'Этот баннер загрузился вместе с первым экраном, хотя лежит на 2400 px ниже. С loading="lazy" он скачался бы, только когда до него долистают.',
        uk: 'Цей банер завантажився разом із першим екраном, хоча лежить на 2400 px нижче. З loading="lazy" він завантажився б, лише коли до нього догорнуть.',
      },
    },
    {
      target: "img-finding-hero",
      set: { imgFinding: "hero" },
      text: {
        en: "The hero is 2048 px wide but never drawn wider than 1080 device pixels. The details show what WebP at the drawn size would weigh: 96 KB instead of 612.",
        ru: "Обложка шириной 2048 px, но нигде не рисуется шире 1080 пикселей устройства. В подробностях видно, сколько весил бы WebP нужного размера: 96 КБ вместо 612.",
        uk: "Обкладинка завширшки 2048 px, але ніде не малюється ширше за 1080 пікселів пристрою. У подробицях видно, скільки важив би WebP потрібного розміру: 96 КБ замість 612.",
      },
    },
    {
      target: "img-filter-warnings",
      set: { imgFilter: "warnings", imgFinding: "none" },
      text: {
        en: "Warnings hides the hints and leaves what is worth fixing first, sorted by how much it saves.",
        ru: "Warnings прячет подсказки и оставляет то, что стоит чинить в первую очередь, по убыванию экономии.",
        uk: "Warnings ховає підказки й залишає те, що варто виправити насамперед, за спаданням економії.",
      },
    },
    {
      target: "tab-svg",
      set: { tab: "svg" },
      text: {
        en: "SVG looks at path data in scripts, styles and pages: icons exported with too many digits, longer commands than needed or shipped several times.",
        ru: "SVG смотрит на данные путей в скриптах, стилях и страницах: иконки с лишними знаками после запятой, длинными командами или в нескольких копиях.",
        uk: "SVG дивиться на дані шляхів у скриптах, стилях і сторінках: іконки із зайвими знаками після коми, довгими командами або в кількох копіях.",
      },
    },
    {
      target: "svg-finding-decimals",
      set: { svgFinding: "decimals" },
      text: {
        en: "A 24-unit icon needs two digits after the point. 120 paths in icons.js keep six; rounding alone takes 18 KB off the bundle.",
        ru: "Иконке размером 24 единицы хватает двух знаков после запятой. 120 путей в icons.js хранят шесть; одно округление снимает с бандла 18 КБ.",
        uk: "Іконці розміром 24 одиниці вистачає двох знаків після коми. 120 шляхів у icons.js зберігають шість; саме округлення знімає з бандла 18 КБ.",
      },
    },
    {
      target: "svg-finding-dupes",
      set: { svgFinding: "dupes" },
      text: {
        en: "The same cart icon ships in three files. Importing it from one module or using a sprite downloads it once.",
        ru: "Одна и та же иконка корзины лежит в трёх файлах. Если импортировать её из одного модуля или взять спрайт, она скачается один раз.",
        uk: "Та сама іконка кошика лежить у трьох файлах. Якщо імпортувати її з одного модуля або взяти спрайт, вона завантажиться один раз.",
      },
    },
    {
      target: "svg-stats",
      action: "look",
      text: {
        en: "Could save adds it all up before gzip: 61 KB of 214 KB of path data. Paste the findings into the ticket for the developers.",
        ru: "Could save суммирует всё до gzip: 61 КБ из 214 КБ данных путей. Вставьте находки в задачу для разработчиков.",
        uk: "Could save підсумовує все до gzip: 61 КБ із 214 КБ даних шляхів. Вставте знахідки в задачу для розробників.",
      },
    },
  ],
} satisfies Scenario
