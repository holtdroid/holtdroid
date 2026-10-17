import Java from "frida-java-bridge"

type Wallpaper = { rows: [string, string][] }

const argb = (hex: number) => hex | 0

function drawLogo(canvas: Java.Wrapper, cx: number, cy: number, size: number) {
  const Paint = Java.use("android.graphics.Paint")
  const fill = (color: number) => {
    const p = Paint.$new(1)
    p.setColor.overload("int").call(p, argb(color))
    return p
  }
  const head = Java.use("android.graphics.Path").$new()
  head.moveTo(8, 40)
  head.arcTo(Java.use("android.graphics.RectF").$new(8, 16, 56, 64), 180, 180)
  head.lineTo(56, 48)
  head.lineTo(8, 48)
  head.close()
  const antenna = fill(0xff3ddc84)
  antenna.setStyle(Java.use("android.graphics.Paint$Style").STROKE.value)
  antenna.setStrokeWidth(4)
  antenna.setStrokeCap(Java.use("android.graphics.Paint$Cap").ROUND.value)
  const dark = fill(0xff1b1b1b)

  canvas.save()
  canvas.translate(cx - size / 2, cy - size / 2)
  canvas.scale(size / 64, size / 64)
  canvas.drawPath(head, fill(0xff8a5a3c))
  canvas.drawLine(20, 16, 16, 9, antenna)
  canvas.drawLine(44, 16, 48, 9, antenna)
  canvas.drawCircle(23, 32, 3.5, dark)
  canvas.drawCircle(41, 32, 3.5, dark)
  canvas.drawOval(27, 35.5, 37, 42.5, fill(0xffd9b48f))
  canvas.drawCircle(32, 38, 1.8, dark)
  canvas.drawRoundRect(4, 48, 60, 56, 4, 4, fill(0xff3ddc84))
  canvas.restore()
}

function render(w: Wallpaper) {
  const info = Java.use("android.hardware.display.DisplayManagerGlobal").getInstance().getDisplayInfo(0)
  const width: number = Math.min(info.logicalWidth.value, info.logicalHeight.value)
  const height: number = Math.max(info.logicalWidth.value, info.logicalHeight.value)
  const dpi: number = info.logicalDensityDpi.value
  const dp = dpi / 160

  const Build = Java.use("android.os.Build")
  const Version = Java.use("android.os.Build$VERSION")
  const rows = [
    ...w.rows,
    ["android", `${Version.RELEASE.value} · API ${Version.SDK_INT.value}`],
    ["abi", Array.from(Build.SUPPORTED_ABIS.value as ArrayLike<string>).join(", ")],
    ["display", `${width}×${height} · ${dpi} dpi`],
  ]

  const bitmap = Java.use("android.graphics.Bitmap").createBitmap(
    width,
    height,
    Java.use("android.graphics.Bitmap$Config").ARGB_8888.value,
  )
  const canvas = Java.use("android.graphics.Canvas").$new(bitmap)
  canvas.drawColor.overload("int").call(canvas, argb(0xff0b0f14))

  const Paint = Java.use("android.graphics.Paint")
  const Typeface = Java.use("android.graphics.Typeface")
  const Align = Java.use("android.graphics.Paint$Align")
  const paint = (color: number, sizeDp = 0) => {
    const p = Paint.$new(1)
    p.setColor.overload("int").call(p, argb(color))
    if (sizeDp) p.setTextSize(sizeDp * dp)
    return p
  }

  const minor = paint(0x0affffff)
  const major = paint(0x14ffffff)
  for (let x = 0, i = 0; x < width; x += 8 * dp, i++) canvas.drawLine(x, 0, x, height, i % 6 ? minor : major)
  for (let y = 0, i = 0; y < height; y += 8 * dp, i++) canvas.drawLine(0, y, width, y, i % 6 ? minor : major)

  const cy = 72 * dp + 48 * dp
  drawLogo(canvas, width / 2, cy, 96 * dp)

  const title = paint(0xffe6edf3, 28)
  title.setTypeface(Typeface.DEFAULT_BOLD.value)
  title.setTextAlign(Align.CENTER.value)
  canvas.drawText("holtdroid", width / 2, cy + 48 * dp + 36 * dp, title)
  const tag = paint(0xff3ddc84, 12)
  tag.setTypeface(Typeface.MONOSPACE.value)
  tag.setTextAlign(Align.CENTER.value)
  canvas.drawText("debug session · not a real device", width / 2, cy + 48 * dp + 58 * dp, tag)

  const label = paint(0xff7d8590, 12)
  label.setTypeface(Typeface.MONOSPACE.value)
  const value = paint(0xffe6edf3, 12)
  value.setTypeface(Typeface.MONOSPACE.value)
  const charW: number = value.measureText("M")
  const labelChars = Math.max(...rows.map(([k]) => k.length)) + 2
  const valueChars = Math.max(8, Math.floor((width - 64 * dp) / charW) - labelChars)
  const fit = (s: string) => {
    if (s.length <= valueChars) return s
    const half = Math.floor((valueChars - 1) / 2)
    return s.slice(0, half) + "…" + s.slice(s.length - (valueChars - 1 - half))
  }
  const lines = rows.map(([k, v]) => [k, fit(v)])
  const lineH = 20 * dp
  const blockW = (labelChars + Math.max(...lines.map(([, v]) => v.length))) * charW
  const left = (width - blockW) / 2
  const top = cy + 48 * dp + 84 * dp
  lines.forEach(([k, v], i) => {
    const y = top + lineH * (i + 1) - 6 * dp
    canvas.drawText(k, left, y, label)
    canvas.drawText(v, left + labelChars * charW, y, value)
  })

  const pad = 12 * dp
  const [l, t, r, b] = [left - pad, top - pad / 2, left + blockW + pad, top + lineH * lines.length + pad / 2]
  const bounds = paint(0x99ff3b30)
  bounds.setStyle(Java.use("android.graphics.Paint$Style").STROKE.value)
  bounds.setStrokeWidth(dp)
  canvas.drawRect(l, t, r, b, bounds)
  const corner = paint(0xffd946ef)
  corner.setStrokeWidth(2 * dp)
  const c = 8 * dp
  for (const [x, y, dx, dy] of [
    [l, t, c, c],
    [r, t, -c, c],
    [l, b, c, -c],
    [r, b, -c, -c],
  ]) {
    canvas.drawLine(x, y, x + dx, y, corner)
    canvas.drawLine(x, y, x, y + dy, corner)
  }

  return bitmap
}

rpc.exports = {
  setLocales(tags: string) {
    return new Promise((resolve) => {
      Java.perform(() => {
        try {
          const locales = Java.use("android.os.LocaleList").forLanguageTags(tags)
          Java.use("com.android.internal.app.LocalePicker").updateLocales(locales)
          resolve({})
        } catch (e) {
          resolve({ error: String(e) })
        }
      })
    })
  },
  setWallpaper(json: string) {
    return new Promise((resolve) => {
      Java.perform(() => {
        try {
          const context = Java.use("android.app.ActivityThread").currentActivityThread().getSystemContext()
          const WallpaperManager = Java.use("android.app.WallpaperManager")
          const which = WallpaperManager.FLAG_SYSTEM.value | WallpaperManager.FLAG_LOCK.value
          const wm = WallpaperManager.getInstance(context)
          wm.setBitmap
            .overload("android.graphics.Bitmap", "android.graphics.Rect", "boolean", "int")
            .call(wm, render(JSON.parse(json)), null, false, which)
          resolve({})
        } catch (e) {
          resolve({ error: String(e) })
        }
      })
    })
  },
}
