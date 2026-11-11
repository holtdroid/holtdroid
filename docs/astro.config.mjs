// @ts-check
import { fileURLToPath } from "node:url"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import starlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import mermaid from "astro-mermaid"
import starlightSidebarTopics from "starlight-sidebar-topics"
import { topics } from "./src/topics.mjs"

export default defineConfig({
	site: "https://holtdroid.github.io",
	redirects: { "/uk": "/", "/ru": "/" },
	vite: {
		plugins: [tailwindcss()],
		resolve: { alias: { "@": fileURLToPath(new URL("../web/src", import.meta.url)) } },
	},
	integrations: [
		mermaid({
			theme: "base",
			autoTheme: false,
			enableLog: false,
			mermaidConfig: {
				fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
				flowchart: { curve: "basis", padding: 14, nodeSpacing: 36, rankSpacing: 52 },
				sequence: { mirrorActors: false, actorMargin: 64, messageMargin: 40 },
				themeVariables: {
					fontSize: "14px",
					background: "#808080",
					mainBkg: "#808080",
					primaryColor: "#808080",
					primaryTextColor: "#808080",
					primaryBorderColor: "#808080",
					lineColor: "#808080",
					textColor: "#808080",
					dropShadow: "none",
				},
			},
		}),
		react(),
		starlight({
			title: "Holtdroid",
			description: "A cozy holt for your test Androids — self-hosted, browser-based Android sandboxes for APK testing.",
			logo: { src: "./src/assets/logo.svg" },
			favicon: "/favicon.svg",
			social: [{ icon: "github", label: "GitHub", href: "https://github.com/holtdroid/holtdroid" }],
			editLink: { baseUrl: "https://github.com/holtdroid/holtdroid/edit/main/docs/" },
			lastUpdated: true,
			defaultLocale: "root",
			locales: {
				root: { label: "English", lang: "en" },
				uk: { label: "Українська", lang: "uk" },
				ru: { label: "Русский", lang: "ru" },
			},
			routeMiddleware: "./src/routeData.ts",
			customCss: [
				"@fontsource-variable/inter",
				"@fontsource-variable/jetbrains-mono",
				"./src/styles/tokens.css",
				"./src/styles/dock.css",
				"./src/styles/theme.css",
				"./src/styles/custom.css",
			],
			components: {
				Head: "./src/components/overrides/Head.astro",
				Header: "./src/components/overrides/Header.astro",
				MobileMenuToggle: "./src/components/overrides/MobileMenuToggle.astro",
				PageFrame: "./src/components/overrides/PageFrame.astro",
				PageTitle: "./src/components/overrides/PageTitle.astro",
				Sidebar: "./src/components/overrides/Sidebar.astro",
			},
			expressiveCode: {
				themes: ["github-dark-default", "github-light-default"],
				styleOverrides: {
					borderRadius: "12px",
					borderColor: "var(--hd-bd)",
					codeBackground: "var(--hd-sf2)",
					codeFontFamily: "var(--hd-mono)",
					codeFontSize: "13px",
					uiFontFamily: "var(--hd-font)",
					frames: {
						shadowColor: "transparent",
						frameBoxShadowCssValue: "none",
						editorTabBarBackground: "var(--hd-sf2)",
						editorActiveTabBackground: "var(--hd-sf2)",
						editorActiveTabForeground: "var(--hd-mu)",
						editorActiveTabIndicatorTopColor: "transparent",
						editorActiveTabIndicatorBottomColor: "var(--hd-tx)",
						editorTabBarBorderBottomColor: "var(--hd-bd)",
						terminalTitlebarBackground: "var(--hd-sf2)",
						terminalTitlebarForeground: "var(--hd-mu)",
						terminalTitlebarBorderBottomColor: "var(--hd-bd)",
						terminalTitlebarDotsForeground: "var(--hd-bd)",
						terminalBackground: "var(--hd-sf2)",
						inlineButtonForeground: "var(--hd-mu)",
						inlineButtonBorder: "var(--hd-bd)",
						tooltipSuccessBackground: "var(--hd-inv)",
						tooltipSuccessForeground: "var(--hd-invtx)",
					},
				},
			},
			plugins: [starlightSidebarTopics(topics.map(({ groupIcons: _, ...topic }) => topic))],
		}),
	],
})
