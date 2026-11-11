import type { Scenario } from "../types"

export default {
  initial: { page: "session", sessions: 1 },
  steps: [
    {
      target: "w-gps",
      action: "look",
      text: {
        en: "The Location row of the Device panel shows where the device thinks it is. By default it follows the VPN country.",
        ru: "Строка Location на панели Device показывает, где устройство «думает», что находится. По умолчанию это страна VPN.",
        uk: "Рядок Location на панелі Device показує, де пристрій «думає», що перебуває. Типово це країна VPN.",
      },
    },
    {
      target: "w-gps",
      action: "click",
      set: { panel: "gps" },
      text: {
        en: "Open the row. It has a map with a blue dot: that's the device.",
        ru: "Раскройте строку. В ней карта с синей точкой — это и есть устройство.",
        uk: "Розгорніть рядок. У ньому мапа із синьою крапкою — це і є пристрій.",
      },
    },
    {
      target: "gps-map",
      action: "look",
      text: {
        en: "Click anywhere on the map or drag the dot to move the device there.",
        ru: "Нажмите в любое место карты или перетащите точку, чтобы перенести туда устройство.",
        uk: "Натисніть будь-де на мапі або перетягніть крапку, щоб перенести туди пристрій.",
      },
    },
    {
      target: "gps-places",
      set: { geo: "almaty" },
      text: {
        en: "Or paste exact coordinates, for example from Google Maps, and press Enter. Here the device jumps to Almaty.",
        ru: "Или вставьте точные координаты, например из Google Maps, и нажмите Enter. Здесь устройство переносится в Алматы.",
        uk: "Або вставте точні координати, наприклад із Google Maps, і натисніть Enter. Тут пристрій переноситься до Алмати.",
      },
    },
    {
      target: "phone",
      action: "look",
      text: {
        en: "The app gets the new location from Android, just like from a real GPS: here the delivery address changed to Almaty.",
        ru: "Приложение получает новое местоположение от Android, как от настоящего GPS: здесь адрес доставки сменился на Алматы.",
        uk: "Застосунок отримує нове розташування від Android, як від справжнього GPS: тут адреса доставки змінилася на Алмати.",
      },
    },
    {
      target: "gps-follow",
      action: "look",
      text: {
        en: "Follow the VPN is now off: the location is set by hand for this session. Turn it back on to match the VPN country again.",
        ru: "Follow the VPN теперь выключено: место задано вручную для этой сессии. Включите обратно, чтобы снова совпадать со страной VPN.",
        uk: "Follow the VPN тепер вимкнено: місце задано вручну для цієї сесії. Увімкніть знову, щоб знову збігатися з країною VPN.",
      },
    },
    {
      target: "gps-route",
      set: { route: true },
      text: {
        en: "Route moves the device along a path at walking or driving speed. Use it for delivery tracking, maps and fitness apps.",
        ru: "Route ведёт устройство по маршруту со скоростью пешехода или машины. Пригодится для отслеживания доставки, карт и фитнес-приложений.",
        uk: "Route веде пристрій маршрутом зі швидкістю пішохода чи автомобіля. Знадобиться для відстеження доставки, мап і фітнес-застосунків.",
      },
    },
    {
      target: "w-gps",
      action: "look",
      set: { panel: "none" },
      text: {
        en: "The row now says Driving. Reset in the row brings the location back to normal.",
        ru: "В строке теперь Driving. Кнопка Reset в строке возвращает местоположение к обычному.",
        uk: "У рядку тепер Driving. Кнопка Reset у рядку повертає розташування до звичайного.",
      },
    },
  ],
} satisfies Scenario
