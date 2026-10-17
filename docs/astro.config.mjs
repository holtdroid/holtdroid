// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
	site: 'https://kriakiku.github.io',
	base: '/holtdroid',
	integrations: [
		mermaid({ autoTheme: true }),
		starlight({
			title: 'Holtdroid',
			description: 'A cozy holt for your test Androids — self-hosted, browser-based Android sandboxes for APK testing.',
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kriakiku/holtdroid' }],
			editLink: { baseUrl: 'https://github.com/kriakiku/holtdroid/edit/main/docs/' },
			lastUpdated: true,
			sidebar: [
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
