import { defineRouteMiddleware } from "@astrojs/starlight/route-data"
import { localized } from "./topics.mjs"

export const onRequest = defineRouteMiddleware((context) => {
  context.locals.starlightRoute.siteTitleHref = localized("/")
})
