import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1, tab: "devtools" },
  steps: [
    {
      target: "tab-pixel-perfect",
      set: { tab: "pixel-perfect" },
      text: {
        en: "Open the Pixel perfect tab. It lays the designer's mockup over the phone screen and finds where they differ.",
        ru: "Откройте вкладку Pixel perfect. Она накладывает макет дизайнера на экран телефона и находит, где они расходятся.",
        uk: "Відкрийте вкладку Pixel perfect. Вона накладає макет дизайнера на екран телефона й знаходить, де вони розходяться.",
      },
    },
    {
      target: "pp-drop",
      action: "look",
      set: { ppReference: true },
      text: {
        en: "Add the mockup: drop an image here, choose a file or paste it with Cmd+V. From Figma, SVG is best: select the frame and Copy as SVG.",
        ru: "Добавьте макет: перетащите картинку сюда, выберите файл или вставьте через Cmd+V. Из Figma лучше всего SVG: выделите фрейм и Copy as SVG.",
        uk: "Додайте макет: перетягніть зображення сюди, оберіть файл або вставте через Cmd+V. З Figma найкраще SVG: виділіть фрейм і Copy as SVG.",
      },
    },
    {
      target: "pp-ref",
      action: "look",
      text: {
        en: "The mockup is now a reference. It belongs to you, not to this session, so it is there next time too.",
        ru: "Макет стал референсом. Он принадлежит вам, а не этой сессии, так что в следующий раз он тоже будет здесь.",
        uk: "Макет став референсом. Він належить вам, а не цій сесії, тож наступного разу він теж буде тут.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "It lies over the screen, half see-through. The phone still works: taps go through the overlay.",
        ru: "Он лежит поверх экрана и наполовину прозрачен. Телефоном можно пользоваться дальше: нажатия проходят сквозь наложение.",
        uk: "Він лежить поверх екрана й наполовину прозорий. Телефоном можна користуватися далі: натискання проходять крізь накладення.",
      },
    },
    {
      target: "pp-opacity",
      action: "look",
      set: { ppOpacity: 25 },
      text: {
        en: "Opacity sets how strongly the mockup shows. Lower it to see the app, raise it to see the design.",
        ru: "Opacity задаёт, насколько заметен макет. Уменьшите, чтобы видеть приложение, увеличьте, чтобы видеть дизайн.",
        uk: "Opacity задає, наскільки помітний макет. Зменште, щоб бачити застосунок, збільште, щоб бачити дизайн.",
      },
    },
    {
      target: "pp-compare",
      set: { ppCompare: true },
      text: {
        en: "Eyes miss a pixel or two. Press Find differences and the screen is compared with the mockup pixel by pixel.",
        ru: "Глаз легко пропускает пиксель-другой. Нажмите Find differences, и экран сравнится с макетом попиксельно.",
        uk: "Око легко пропускає піксель-другий. Натисніть Find differences, і екран порівняється з макетом попіксельно.",
      },
    },
    {
      target: "pp-item-0",
      action: "look",
      text: {
        en: "Each difference gets a plain explanation: shifted by how many pixels, a different colour, something missing.",
        ru: "Каждое расхождение объяснено простыми словами: сдвиг на сколько-то пикселей, другой цвет, чего-то не хватает.",
        uk: "Кожну розбіжність пояснено простими словами: зсув на скількись пікселів, інший колір, чогось бракує.",
      },
    },
    {
      target: "pp-item-1",
      set: { ppIssue: 1 },
      text: {
        en: "Click a difference to find it on the screen.",
        ru: "Нажмите на расхождение, чтобы найти его на экране.",
        uk: "Натисніть на розбіжність, щоб знайти її на екрані.",
      },
    },
    {
      target: "pp-issue-1",
      action: "look",
      text: {
        en: "It is outlined right on the phone: here the price uses a slightly different shade of green.",
        ru: "Оно обведено прямо на телефоне: здесь цена другого, чуть отличающегося оттенка зелёного.",
        uk: "Її обведено просто на телефоні: тут ціна іншого, трохи відмінного відтінку зеленого.",
      },
    },
    {
      target: "pp-export",
      action: "look",
      text: {
        en: "Export report saves a picture with the mockup, the difference and the screen side by side, plus the list. Attach it to the task for the developer or designer.",
        ru: "Export report сохраняет картинку, где рядом макет, разница и экран, плюс список расхождений. Приложите её к задаче для разработчика или дизайнера.",
        uk: "Export report зберігає зображення, де поруч макет, різниця й екран, плюс список розбіжностей. Додайте його до задачі для розробника чи дизайнера.",
      },
    },
  ],
} satisfies Scenario
