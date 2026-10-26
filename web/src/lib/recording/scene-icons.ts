import {
  ActivityIcon,
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  BugIcon,
  CheckIcon,
  ClockIcon,
  FlagIcon,
  GlobeIcon,
  type LucideIcon,
  MoonIcon,
  PinIcon,
  PlaneIcon,
  SmartphoneIcon,
  StarIcon,
  TriangleAlertIcon,
  WifiIcon,
  ZapIcon,
} from "lucide-react"
import { createElement } from "react"
import { md, series } from "@/lib/recording/android"

export const iconSet = {
  wifi: WifiIcon,
  mobile: SmartphoneIcon,
  airplane: PlaneIcon,
  saver: ZapIcon,
  dark: MoonIcon,
  batteryFull: BatteryFullIcon,
  batteryMedium: BatteryMediumIcon,
  batteryLow: BatteryLowIcon,
  batteryCharging: BatteryChargingIcon,
  device: SmartphoneIcon,
  network: GlobeIcon,
  resources: ActivityIcon,
  clock: ClockIcon,
  pin: PinIcon,
  bug: BugIcon,
  flag: FlagIcon,
  star: StarIcon,
  alert: TriangleAlertIcon,
  check: CheckIcon,
} satisfies Record<string, LucideIcon>

export type SceneIconName = keyof typeof iconSet

const colors = [
  md.outline,
  md.onPrimaryContainer,
  md.warn,
  md.onSurfaceVariant,
  md.onSurface,
  md.primary,
  md.error,
  md.surface,
  series.blue,
]

const cache = new Map<string, HTMLImageElement>()
const raster = 96

/** Renders the icons the video scene uses, in every colour it draws them in, so they can be painted on a canvas. */
export async function loadSceneIcons() {
  const { renderToStaticMarkup } = await import("react-dom/server")
  await Promise.all(
    Object.entries(iconSet).flatMap(([name, Icon]) =>
      colors.map(async (color) => {
        const svg = renderToStaticMarkup(createElement(Icon, { size: raster, color, strokeWidth: 2 }))
        const img = new Image()
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        try {
          await img.decode()
          cache.set(`${name}|${color}`, img)
        } catch {
          return
        }
      }),
    ),
  )
}

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: SceneIconName,
  color: string,
  x: number,
  y: number,
  size: number,
) {
  const img = cache.get(`${name}|${color}`)
  if (img) ctx.drawImage(img, x, y, size, size)
}
