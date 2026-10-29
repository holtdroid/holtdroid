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
	vite: {
		plugins: [tailwindcss()],
		resolve: { alias: { '@': fileURLToPath(new URL('../web/src', import.meta.url)) } },
	},
	integrations: [
		mermaid({ autoTheme: true }),
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
				ru: { label: 'Русский', lang: 'ru' },
				uk: { label: 'Українська', lang: 'uk' },
			},
			customCss: ['@fontsource-variable/geist', './src/styles/theme.css', './src/styles/custom.css'],
			components: {
				PageTitle: './src/components/overrides/PageTitle.astro',
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
				starlightSidebarTopics(topics),
			],
		}),
	],
});
