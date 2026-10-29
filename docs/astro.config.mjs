// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import mermaid from 'astro-mermaid';

/** @param {string} label @param {string} ru @param {string} uk @param {string} directory */
const guides = (label, ru, uk, directory) => ({
	label,
	translations: { ru, uk },
	items: [{ autogenerate: { directory: `guides/${directory}` } }],
});

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
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Guides',
					translations: { ru: 'Гайды', uk: 'Посібники' },
					items: [
						guides('First steps', 'Первые шаги', 'Перші кроки', 'first-steps'),
						guides('Debugging web content', 'Отладка веба', 'Налагодження вебу', 'web'),
						guides('Real-world conditions', 'Условия реального мира', 'Реальні умови', 'conditions'),
						guides('Working with the app', 'Работа с приложением', 'Робота із застосунком', 'app'),
						guides('Design', 'Дизайн', 'Дизайн', 'design'),
						guides('Recordings and bug reports', 'Записи и баг-репорты', 'Записи та баг-репорти', 'recordings'),
						guides('For developers', 'Для разработчиков', 'Для розробників', 'developers'),
					],
				},
				{ label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
				{ label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
				{ label: 'Configuration', items: [{ autogenerate: { directory: 'configuration' } }] },
				{ label: 'APK sources', items: [{ autogenerate: { directory: 'sources' } }] },
				{ label: 'Tools', items: [{ autogenerate: { directory: 'tools' } }] },
				{ label: 'Operations', items: [{ autogenerate: { directory: 'operations' } }] },
				{ label: 'Extending', items: [{ autogenerate: { directory: 'extending' } }] },
			],
		}),
	],
});
