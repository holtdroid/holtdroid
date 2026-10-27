(() => {
  const key = "__holtdroidImages"
  let s = window[key]
  if (!s) {
    let next = 0
    const ids = new WeakMap()
    const id = (el) => {
      let n = ids.get(el)
      if (n === undefined) ids.set(el, (n = ++next))
      return n
    }
    const sent = new Map()
    const svgEls = new WeakSet()
    const markup = new Set()
    let svgBytes = 0
    let dirty = true
    let scanned = -Infinity
    let backgrounds = []
    const inView = new WeakMap()
    const observed = new WeakSet()
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const e of entries) inView.set(e.target, e.isIntersecting)
          })
        : null
    new MutationObserver(() => (dirty = true)).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    })
    const abs = (u) => {
      try {
        return new URL(u, document.baseURI).href
      } catch {
        return ""
      }
    }
    const scanBackgrounds = () => {
      backgrounds = []
      for (const el of document.querySelectorAll("body *")) {
        for (const pseudo of [null, "::before", "::after"]) {
          const cs = getComputedStyle(el, pseudo)
          if (pseudo && cs.content === "none") continue
          const v = cs.backgroundImage
          if (!v || !v.includes("url(")) continue
          for (const m of v.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) {
            backgrounds.push({ el, src: abs(m[2]), fit: cs.backgroundSize })
          }
          if (backgrounds.length > 2000) return
        }
      }
    }
    const take = () => {
      if (document.visibilityState === "hidden" || !document.body) return null
      const now = performance.now()
      if (dirty && now - scanned > 3000) {
        dirty = false
        scanned = now
        scanBackgrounds()
      }
      const vw = innerWidth
      const vh = innerHeight
      const uses = []
      const add = (el, src, kind, natural, fit) => {
        if (uses.length >= 300 || !src || src.startsWith("data:") || src.startsWith("blob:")) return
        const r = el.getBoundingClientRect()
        const rendered =
          r.width > 0 &&
          r.height > 0 &&
          (!el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        if (io && !observed.has(el)) {
          observed.add(el)
          io.observe(el)
        }
        const shown =
          rendered && (io ? inView.get(el) === true : r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw)
        const w = Math.round(r.width * 10) / 10
        const h = Math.round(r.height * 10) / 10
        const [nw, nh] = natural ? natural() : [0, 0]
        const k = `${id(el)} ${kind} ${src}`
        const sig = `${w}x${h} ${nw}x${nh} ${rendered}`
        const before = sent.get(k)
        if (before && before.sig === sig && (before.shown || !shown)) return
        sent.set(k, { sig, shown: shown || !!before?.shown })
        const u = { element: id(el), src: src.slice(0, 2048), kind, width: w, height: h }
        if (nw) {
          u.naturalWidth = nw
          u.naturalHeight = nh
        }
        const f = fit()
        if (f) u.fit = f
        if (shown) u.shown = true
        if (!rendered) u.hidden = true
        uses.push(u)
      }
      for (const img of document.images) {
        add(
          img,
          img.currentSrc || img.src,
          "img",
          () => [img.naturalWidth, img.naturalHeight],
          () => {
            const v = getComputedStyle(img).objectFit
            return v === "fill" ? "" : v
          },
        )
      }
      for (const el of document.querySelectorAll("input[type=image]")) {
        add(el, el.src, "input", null, () => "")
      }
      for (const el of document.querySelectorAll("video[poster]")) {
        add(el, el.poster, "poster", null, () => getComputedStyle(el).objectFit)
      }
      for (const el of document.querySelectorAll("image")) {
        const href = el.href?.baseVal || el.getAttribute("href") || el.getAttribute("xlink:href")
        if (href) add(el, abs(href), "svg", null, () => "")
      }
      for (const b of backgrounds) {
        if (b.el.isConnected) add(b.el, b.src, "css", null, () => (b.fit === "auto" ? "" : b.fit))
      }
      const svgs = []
      for (const el of document.getElementsByTagName("svg")) {
        if (svgEls.has(el) || el.ownerSVGElement || svgBytes > 1 << 20) continue
        svgEls.add(el)
        const m = el.outerHTML
        if (m.length > 65536 || markup.has(m)) continue
        markup.add(m)
        svgBytes += m.length
        svgs.push(m)
      }
      if (!uses.length && !svgs.length) return null
      return { url: location.href, width: vw, height: vh, dpr: devicePixelRatio, uses, svgs }
    }
    s = window[key] = { take }
  }
  return s.take()
})()
