type LayoutMap = { get(code: string): string | undefined }
type KeyboardAPI = { getLayoutMap(): Promise<LayoutMap> }

export const baseLayout = "en-US"

export function guessLayout(map: LayoutMap): string | null {
  const key = (code: string) => map.get(code)?.toLowerCase()
  const q = key("KeyQ")
  if (q === "й") return key("KeyS") === "і" ? "uk-UA" : key("Digit2") === "ә" ? "kk-KZ" : "ru-RU"
  if (q === "a" && key("KeyW") === "z") return "fr-FR"
  if (key("KeyY") === "z") {
    if (key("BracketLeft") === "ü") return "de-DE"
    if (key("BracketLeft") === "ú") return "cs-CZ"
    if (key("BracketLeft") === "ő") return "hu-HU"
    return "de-DE"
  }
  if (q === "ς" || key("KeyW") === "ς") return "el-GR"
  if (key("KeyE") === "ק") return "he-IL"
  if (q === "ض") return key("KeyH") === "ا" ? "ar-SA" : "fa-IR"
  if (q === "ქ") return "ka-GE"
  if (q === "ք" || q === "ճ") return "hy-AM"
  if (key("Semicolon") === "ł") return "pl-PL"
  if (key("Semicolon") === "ö" && key("Quote") === "ä") return key("BracketLeft") === "å" ? "sv-SE" : "fi-FI"
  if (key("Semicolon") === "ø" || key("Quote") === "ø") return key("Quote") === "æ" ? "nb-NO" : "da-DK"
  if (key("Semicolon") === "ñ") return "es-ES"
  if (key("Semicolon") === "ş" || key("BracketLeft") === "ğ") return "tr-TR"
  if (key("Digit1") === "ą") return "lt-LT"
  return null
}

export async function detectLayouts(): Promise<string[]> {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardAPI }).keyboard
  const found = keyboard ? guessLayout(await keyboard.getLayoutMap().catch(() => ({ get: () => undefined }))) : null
  return found && found !== baseLayout ? [baseLayout, found] : [baseLayout]
}

export function desiredLocales(language: string, layouts: string[]) {
  return [language, ...layouts.filter((l) => l.toLowerCase() !== language.toLowerCase())]
}

const norm = (l: string[]) => l.map((t) => t.toLowerCase())

export function sameLocales(a: string[], b: string[]) {
  const [x, y] = [norm(a), norm(b)]
  return x[0] === y[0] && x.length === y.length && x.every((t) => y.includes(t))
}
