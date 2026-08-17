/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import { ContentClient, PortaliqBuildError, redact } from './contentClient.js'

/**
 * A Docusaurus plugin that builds a site from a Portaliq portal.
 *
 * The portal's own renderer and this plugin consume the SAME public contract,
 * which is the point: if a capability needs something the contract cannot
 * supply, that is an API gap to report rather than a workaround to write here.
 * A workaround ends the headless property quietly — the site keeps building and
 * the contract stops being sufficient without anybody deciding that.
 *
 * @spec openspec/changes/docusaurus-plugin-portaliq/specs/docusaurus-plugin-portaliq/spec.md
 */

/**
 * Capabilities the built-in renderer has and the public contract does not
 * expose. Reported at build time, by name, instead of being papered over.
 *
 * @type {Array<{name: string, why: string}>}
 */
const KNOWN_API_GAPS = [
	{
		name: 'widget grid geometry',
		why: 'a page body of type `grid` carries 12-column placements the public '
			+ 'contract exposes but Docusaurus has no layout to receive; such pages '
			+ 'are published as their markdown blocks in order.',
	},
	{
		name: 'contributed pages',
		why: 'contributed surfaces are an index of what a leaf app offers on a live '
			+ 'portal; a static build has no session to act on them.',
	},
]

/**
 * Turn a portal menu into a Docusaurus sidebar.
 *
 * Two-level nesting becomes a category with items — deeper trees are reported
 * rather than flattened, because a flattened sidebar looks complete.
 *
 * @param {Array} menus The portal's menus.
 * @return {Array} A Docusaurus sidebar definition.
 */
export function sidebarFrom(menus) {
	const sidebar = []

	for (const menu of menus || []) {
		for (const item of (menu && menu.items) || []) {
			const children = item.items || []
			if (children.length === 0) {
				sidebar.push({ type: 'doc', id: docIdFor(item.link), label: item.name })
				continue
			}

			sidebar.push({
				type: 'category',
				label: item.name,
				items: children.map((child) => ({
					type: 'doc',
					id: docIdFor(child.link),
					label: child.name,
				})),
			})
		}
	}

	return sidebar
}

/**
 * The document id for a portal route.
 *
 * `/` becomes `index`; everything else keeps its shape so a portal route and a
 * built URL stay recognisably the same thing.
 *
 * @param {string} route The portal route.
 * @return {string} The doc id.
 */
export function docIdFor(route) {
	const path = String(route || '/').replace(/^\/+/, '').replace(/\/+$/, '')
	return path === '' ? 'index' : path
}

/**
 * The markdown a page contributes, UNCONVERTED.
 *
 * Docusaurus has its own MDX pipeline, and running markdown through a second
 * converter first is how a code fence or a table arrives broken. This only
 * concatenates what the contract already carries.
 *
 * @param {object} page The page record.
 * @return {string} The markdown.
 */
export function markdownFor(page) {
	const body = (page && page.body) || {}
	if (typeof body.markdown === 'string') {
		return body.markdown
	}

	const blocks = Array.isArray(body.widgets) ? body.widgets : []
	return blocks
		.filter((w) => w && w.widgetKey === 'markdown')
		.map((w) => String((w.props && w.props.markdown) || ''))
		.join('\n\n')
}

/**
 * The `<script>` tag that loads the portal's own traffic client.
 *
 * LOADED FROM THE PORTAL, NOT BUNDLED HERE. That is the point: the file this
 * tag fetches is the same file the portal's built-in renderer runs, so a
 * statically built site and a server-rendered one cannot come to different
 * conclusions about what a visitor's browser may store. Vendoring a copy into
 * this package would create exactly the divergence the shared source exists to
 * prevent, and the copy that drifted would be the one nobody is watching.
 *
 * It carries no configuration of its own beyond WHERE to ask. The script
 * fetches the portal's live traffic settings at runtime, so switching
 * measurement off takes effect without rebuilding the site — a privacy
 * decision that requires a rebuild is a privacy decision that does not work.
 *
 * @param {object} options         The plugin options.
 * @param {string} options.baseUrl The portal origin.
 * @param {string} options.appPath The app's route prefix.
 * @param {string} options.portal  The portal slug.
 * @return {object} A Docusaurus tag description.
 */
export function trafficScriptTag({ baseUrl, appPath, portal }) {
	const origin = String(baseUrl || '').replace(/\/$/, '')
	const path = String(appPath || '').replace(/\/$/, '')

	// A ROUTE, NOT A FILE PATH. The obvious URL —
	// `<app>/js/portaliq-traffic.js` — answers 401 to an anonymous caller,
	// which is every caller a public portal has; the path that does serve it
	// depends on where the instance keeps its apps. Measured, not assumed: the
	// file path returned `401` with a 43-byte JSON body, and only
	// `/custom_apps/…` returned the script.
	return {
		tagName: 'script',
		attributes: {
			src: `${origin}${path}/api/traffic-client.js`,
			defer: true,
			'data-origin': origin,
			'data-portal': portal || '',
			'data-appPath': path,
		},
	}
}

/**
 * The plugin.
 *
 * @param {object} context The Docusaurus context.
 * @param {object} options The plugin options.
 * @return {object} The plugin instance.
 */
export default function pluginPortaliq(context, options = {}) {
	const {
		baseUrl,
		portal = '',
		appPath = '/index.php/apps/portaliq',
		token = '',
		expected = {},
		snapshot = null,
		traffic = true,
		fetchImpl,
	} = options

	return {
		name: 'docusaurus-plugin-portaliq',

		/**
		 * Fetch everything the site is built from.
		 *
		 * A SNAPSHOT IS NEVER A SILENT FALLBACK. It is used only when the
		 * configuration explicitly enables it; otherwise an unreachable API
		 * fails the build. A plugin that quietly serves yesterday's content
		 * when today's is unavailable publishes a site nobody knows is stale.
		 *
		 * @return {Promise<object>} The loaded content.
		 */
		async loadContent() {
			const client = new ContentClient({ baseUrl, appPath, portal, token, fetchImpl })

			try {
				return await client.loadAll(expected)
			} catch (error) {
				if (snapshot && snapshot.enabled === true && snapshot.content) {
					// Announced, never silent.
					// eslint-disable-next-line no-console
					console.warn(
						redact(
							`[portaliq] using the configured snapshot: ${error.message}`,
							token,
						),
					)
					return snapshot.content
				}

				throw error instanceof PortaliqBuildError
					? error
					: new PortaliqBuildError(redact(String(error && error.message), token))
			}
		},

		/**
		 * Hand the content to Docusaurus as docs, a sidebar and a glossary.
		 *
		 * @param {object} args           The hook arguments.
		 * @param {object} args.content   What `loadContent` returned.
		 * @param {object} args.actions   Docusaurus actions.
		 * @return {Promise<void>} Resolves when the data is written.
		 */
		async contentLoaded({ content, actions }) {
			const { createData, setGlobalData } = actions

			const docs = (content.pages || []).map((page) => ({
				id: docIdFor(page.route),
				title: page.title || '',
				markdown: markdownFor(page),
			}))

			await createData('portaliq-docs.json', JSON.stringify(docs, null, 2))
			await createData(
				'portaliq-glossary.json',
				JSON.stringify((content.glossary && content.glossary.terms) || [], null, 2),
			)

			// The gaps travel WITH the build output, so the next person reading
			// the site knows what the contract did not supply.
			setGlobalData({
				site: content.site,
				sidebar: sidebarFrom(content.menus),
				apiGaps: KNOWN_API_GAPS,
			})

			for (const gap of KNOWN_API_GAPS) {
				// eslint-disable-next-line no-console
				console.info(`[portaliq] API gap — ${gap.name}: ${gap.why}`)
			}
		},

		/**
		 * Load the portal's traffic client, when the site wants measuring.
		 *
		 * `traffic: false` in the plugin options declines it outright, and that
		 * is a genuine off switch rather than a hint: the tag is never emitted,
		 * so nothing is fetched and nothing runs. Left on, the script still
		 * measures nothing unless the PORTAL has enabled it — two independent
		 * switches, both of which must be on, because the site's operator and
		 * the portal's operator can be different people.
		 *
		 * @return {object} The tags to inject.
		 */
		injectHtmlTags() {
			if (traffic === false) {
				return {}
			}

			return {
				headTags: [trafficScriptTag({ baseUrl, appPath, portal })],
			}
		},
	}
}

export { KNOWN_API_GAPS }
