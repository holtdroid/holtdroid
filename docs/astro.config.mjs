// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import mermaid from 'astro-mermaid';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import { topics } from './src/topics.mjs';

export default defineConfig({
	site: 'https://holtdroid.github.io',
	base: '/holtdroid',
	redirects: { '/uk': '/holtdroid/', '/ru': '/holtdroid/' },
	vite: {
		plugins: [tailwindcss()],
		resolve: { alias: { '@': fileURLToPath(new URL('../web/src', import.meta.url)) } },
	},
	integrations: [
		mermaid({
			theme: 'base',
			autoTheme: false,
			enableLog: false,
			mermaidConfig: {
				fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
				flowchart: { curve: 'basis', padding: 14, nodeSpacing: 36, rankSpacing: 52 },
				sequence: { mirrorActors: false, actorMargin: 64, messageMargin: 40 },
				themeVariables: {
					darkMode: true,
					fontSize: '14px',
					background: '#0d0f0c',
					mainBkg: '#151813',
					primaryColor: '#151813',
					primaryTextColor: '#ededea',
					primaryBorderColor: '#2f5a40',
					nodeBorder: '#2f5a40',
					secondaryColor: '#121411',
					tertiaryColor: '#0f110e',
					textColor: '#c3c5bd',
					lineColor: '#4f8a66',
					clusterBkg: '#0f110e',
					clusterBorder: '#34362f',
					titleColor: '#9a9d95',
					edgeLabelBackground: '#0d0f0c',
					actorBkg: '#151813',
					actorBorder: '#2f5a40',
					actorTextColor: '#ededea',
					actorLineColor: '#34362f',
					signalColor: '#4f8a66',
					signalTextColor: '#c3c5bd',
					labelBoxBkgColor: '#151813',
					labelBoxBorderColor: '#2f5a40',
					labelTextColor: '#ededea',
					noteBkgColor: '#121411',
					noteBorderColor: '#34362f',
					noteTextColor: '#c3c5bd',
					activationBkgColor: '#1d2a22',
					activationBorderColor: '#3ddc84',
					transitionColor: '#4f8a66',
					transitionLabelColor: '#9a9d95',
					stateLabelColor: '#ededea',
					stateBkg: '#151813',
					compositeBackground: '#0f110e',
					compositeTitleBackground: '#0f110e',
					compositeBorder: '#34362f',
					altBackground: '#0f110e',
					specialStateColor: '#3ddc84',
					innerEndBackground: '#3ddc84',
				},
			},
		}),
		react(),
		starlight({
			title: 'Holtdroid',
			description: 'A cozy holt for your test Androids — self-hosted, browser-based Android sandboxes for APK testing.',
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/holtdroid/holtdroid' }],
			editLink: { baseUrl: 'https://github.com/holtdroid/holtdroid/edit/main/docs/' },
			lastUpdated: true,
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				uk: { label: 'Українська', lang: 'uk' },
				ru: { label: 'Русский', lang: 'ru' },
			},
			routeMiddleware: './src/routeData.ts',
			customCss: ['@fontsource-variable/geist', './src/styles/theme.css', './src/styles/custom.css'],
			components: {
				PageTitle: './src/components/overrides/PageTitle.astro',
				LanguageSelect: './src/components/overrides/LanguageSelect.astro',
				Sidebar: './src/components/overrides/Sidebar.astro',
				ThemeProvider: './src/components/overrides/ThemeProvider.astro',
				ThemeSelect: './src/components/overrides/ThemeSelect.astro',
			},
			expressiveCode: {
				themes: ['github-dark-default'],
				styleOverrides: {
					borderRadius: '0.75rem',
					borderColor: 'rgb(255 255 255 / 0.08)',
					codeBackground: '#0f110e',
					codeFontSize: '0.8125rem',
					frames: {
						shadowColor: 'transparent',
						editorTabBarBackground: '#0f110e',
						editorActiveTabBackground: '#0f110e',
						terminalTitlebarBackground: '#121411',
						terminalBackground: '#0f110e',
					},
				},
			},
			plugins: [
				starlightSidebarTopics(topics.map(({ groupIcons: _, ...topic }) => topic)),
			],
		}),
	],
});
