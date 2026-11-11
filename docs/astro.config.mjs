// @ts-check
import { fileURLToPath } from "node:url"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"
import starlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import mermaid from "astro-mermaid"
import starlightLlmsTxt from "starlight-llms-txt"
import starlightSidebarTopics from "starlight-sidebar-topics"
import { pageIndex } from "./src/llms.mjs"
import { topics } from "./src/topics.mjs"

const site = "https://holtdroid.github.io"
const socialImage = "https://github.com/holtdroid/.github/raw/main/profile/assets/social-holtdroid.png"

export default defineConfig({
	site,
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
			description:
				"Self-hosted, open-source Android devices in the browser for testing APKs and WebViews: emulators on Kubernetes and real phones, with DevTools, a VPN country per device and recordings.",
			logo: { src: "./src/assets/logo.svg" },
			favicon: "/favicon.svg",
			head: [
				{ tag: "meta", attrs: { property: "og:image", content: socialImage } },
				{ tag: "meta", attrs: { name: "twitter:image", content: socialImage } },
			],
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
			plugins: [
				starlightSidebarTopics(topics.map(({ groupIcons: _, ...topic }) => topic)),
				starlightLlmsTxt({
					description:
						"Holtdroid is a self-hosted, open-source (Apache-2.0) web portal that launches Android devices on demand for testing APKs. Each device opens in a browser tab with its screen, Chrome DevTools for the app's WebViews (enabled at runtime, the APK is never modified), Logcat, files, a terminal, network shaping, GPS, a VPN country per device, recordings and bug reports.",
					details: [
						"- Runs on Kubernetes (Helm chart): virtual devices are redroid Pods (Android 11–16), real phones plug into a host over USB.",
						"- Builds come from sources: folders or S3 buckets that sync jobs fill from Slack, S3, GitHub releases, Chromium and browser release archives, plus uploads.",
						"- Not a cloud service: there is no hosted instance to sign up for; you install it on your own cluster. No iOS.",
						"- Sign-in: anonymous, a shared password, OIDC, a forward-auth header, or users with passkeys.",
						"- Source code: https://github.com/holtdroid/holtdroid. The portal's HTTP API is described by OpenAPI at `/api/docs` on every installation.",
						"",
						"Pages of the documentation, each with what it covers:",
						"",
						pageIndex(site),
					].join("\n"),
					customSets: [
						{ label: "Guides", description: "task-by-task guides for testers using the portal", paths: ["guides/**"] },
						{
							label: "Running Holtdroid",
							description: "installation, configuration, APK sources and operations for administrators",
							paths: ["start/installation", "configuration/**", "sources/**", "operations/**"],
						},
					],
					promote: ["start/introduction", "start/alternatives", "start/installation"],
				}),
			],
		}),
	],
})
