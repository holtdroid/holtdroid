// Loaded into the DevTools frontend by the session page: selects the Console's
// execution context of the frame in ?frame= and tells the page whether it could.
const params = new URL(import.meta.url).searchParams
const frame = params.get("frame")
const report = (ok) => window.parent.postMessage({ type: "holtdroid-devtools-context", frame, ok }, window.location.origin)

try {
  const base = document.baseURI
  const [SDK, UI] = await Promise.all([
    import(new URL("core/sdk/sdk.js", base).href),
    import(new URL("ui/legacy/legacy.js", base).href),
  ])
  const find = () => {
    for (const model of SDK.TargetManager.TargetManager.instance().models(SDK.RuntimeModel.RuntimeModel)) {
      for (const context of model.executionContexts()) {
        if (context.frameId === frame && context.isDefault) return context
      }
    }
    return null
  }
  const deadline = Date.now() + 20_000
  const tick = () => {
    const context = find()
    if (context) {
      UI.Context.Context.instance().setFlavor(SDK.RuntimeModel.ExecutionContext, context)
      void UI.ViewManager.ViewManager.instance().showView("console")
      report(true)
    } else if (Date.now() > deadline) report(false)
    else setTimeout(tick, 250)
  }
  tick()
} catch {
  report(false)
}
