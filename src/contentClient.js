/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * Fetching a portal's content over its PUBLIC contract, and nothing else.
 *
 * THE ARCHITECTURAL VALUE OF THIS PLUGIN IS WHAT IT CANNOT REACH. Every request
 * it makes goes to `/api/content/*` — the anonymous, publicly cacheable surface
 * a visitor's browser could fetch itself. There is no code path here to an
 * admin route, an OCS endpoint or a database, which is what makes "headless"
 * a property rather than a promise, and it is asserted by intercepting the
 * requests a build makes rather than by reading this paragraph.
 *
 * @spec openspec/changes/docusaurus-plugin-portaliq/specs/docusaurus-plugin-portaliq/spec.md#requirement-the-plugin-must-build-a-site-from-the-public-api-alone
 */

/** The only path prefix this client is allowed to request. */
const PUBLIC_PREFIX = '/api/content/'

/**
 * Redact anything token-shaped from a string.
 *
 * Applied to every message this module produces, INCLUDING failures — that is
 * the path that serialises context, and a build log is an artefact that
 * outlives the build. A token is redacted by value rather than by key name,
 * because the value is what leaks when a URL or a header dump ends up in a
 * message nobody wrote by hand.
 *
 * @param {string} text  The message.
 * @param {string} token The configured token, if any.
 * @return {string} The message, with the token replaced.
 */
export function redact(text, token) {
	const message = String(text == null ? '' : text)
	if (!token) {
		return message
	}

	return message.split(String(token)).join('«redacted»')
}

/**
 * An error a build should stop on, carrying a message safe to print.
 */
export class PortaliqBuildError extends Error {
	/**
	 * @param {string} message The redacted message.
	 */
	constructor(message) {
		super(message)
		this.name = 'PortaliqBuildError'
	}
}

/**
 * A client bound to one portal's public content API.
 */
export class ContentClient {
	/**
	 * @param {object}   options            The configuration.
	 * @param {string}   options.baseUrl    The portal origin, e.g. `https://portal.example`.
	 * @param {string}   options.appPath    The app's route prefix.
	 * @param {string}   options.portal     The portal slug.
	 * @param {string}   options.token      An optional bearer, never written to output.
	 * @param {Function} options.fetchImpl  Injected for tests; defaults to global fetch.
	 */
	constructor({ baseUrl, appPath = '/index.php/apps/portaliq', portal = '', token = '', fetchImpl = fetch }) {
		if (!baseUrl) {
			throw new PortaliqBuildError('portaliq: `baseUrl` is required')
		}

		this.baseUrl = String(baseUrl).replace(/\/$/, '')
		this.appPath = String(appPath).replace(/\/$/, '')
		this.portal = String(portal || '')
		this.token = String(token || '')
		this.fetchImpl = fetchImpl
	}

	/**
	 * Fetch one public content resource.
	 *
	 * REFUSES ANY PATH OUTSIDE THE PUBLIC PREFIX before making the request. The
	 * guarantee is worth enforcing in code rather than trusting to call sites:
	 * a future contributor adding one convenient admin call would end the
	 * headless property quietly, and this throws instead.
	 *
	 * @param {string} resource The resource name, e.g. `site`.
	 * @param {object} params   Extra query parameters.
	 * @return {Promise<object>} The parsed body.
	 */
	async get(resource, params = {}) {
		const url = new URL(this.baseUrl + `${this.appPath}${PUBLIC_PREFIX}${resource}`)

		// THE CHECK IS ON THE RESOLVED PATHNAME, NOT THE STRING THAT BUILT IT.
		//
		// Checking the concatenation was the first version and it was wrong:
		// `new URL()` normalises `..`, so a resource of `../../../admin/settings`
		// produced a string that still contained `/api/content/` and a URL that
		// pointed at `/admin/settings`. The guarantee this plugin rests on is
		// about the request that leaves, so that is what is inspected. A test
		// asks for exactly that traversal.
		if (url.pathname.includes(PUBLIC_PREFIX) === false) {
			throw new PortaliqBuildError(
				`portaliq: refused a request outside the public content API: ${resource}`,
			)
		}
		if (this.portal) {
			url.searchParams.set('portal', this.portal)
		}
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, String(value))
		}

		const headers = { Accept: 'application/json' }
		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`
		}

		let response
		try {
			response = await this.fetchImpl(url.toString(), { headers })
		} catch (cause) {
			// THE ENDPOINT IS NAMED, THE TOKEN IS NOT. A build that fails with
			// "fetch failed" sends somebody to the wrong place for an hour.
			throw new PortaliqBuildError(
				redact(
					`portaliq: cannot reach ${url.toString()} — ${cause && cause.message}`,
					this.token,
				),
			)
		}

		if (response.ok === false) {
			throw new PortaliqBuildError(
				redact(
					`portaliq: ${url.toString()} answered ${response.status}`,
					this.token,
				),
			)
		}

		return response.json()
	}

	/**
	 * Everything a site build needs, in one call.
	 *
	 * @param {object} expected The configured minimum counts.
	 * @return {Promise<object>} `{site, menus, pages, glossary}`.
	 */
	async loadAll(expected = {}) {
		const site = await this.get('site')
		const menus = await this.get('menus')
		const glossary = await this.get('glossary')

		const menuList = Array.isArray(menus.menus) ? menus.menus : []
		const routes = routesFrom(menuList)
		const pages = []
		for (const route of routes) {
			pages.push(await this.get('page', { path: route }))
		}

		assertAtLeast('menus', menuList.length, expected.menus)
		assertAtLeast('pages', pages.length, expected.pages)
		assertAtLeast(
			'glossary',
			Array.isArray(glossary.terms) ? glossary.terms.length : 0,
			expected.glossary,
		)

		return { site, menus: menuList, pages, glossary }
	}
}

/**
 * Fail a build when a response carries less than was expected.
 *
 * STATES BOTH COUNTS. Silent content loss is the failure mode that looks
 * exactly like success — a build that publishes three of thirty pages is green,
 * fast and wrong — so the message has to make the gap arithmetic rather than
 * adjectival.
 *
 * A zero expectation means "unchecked", which is why it is opt-in per resource:
 * a portal legitimately starting empty must be able to build.
 *
 * @param {string} what     The resource name.
 * @param {number} actual   What arrived.
 * @param {number} expected The configured minimum.
 * @return {void}
 */
export function assertAtLeast(what, actual, expected) {
	const minimum = Number(expected || 0)
	if (minimum <= 0) {
		return
	}

	if (actual < minimum) {
		throw new PortaliqBuildError(
			`portaliq: expected at least ${minimum} ${what}, received ${actual} — `
				+ 'refusing to publish incomplete content',
		)
	}
}

/**
 * Every route a menu tree points at, deduplicated and in order.
 *
 * Two levels, because that is what a Docusaurus sidebar category expresses; a
 * third would have to be flattened, and flattening silently is how a site loses
 * pages nobody notices are missing.
 *
 * @param {Array} menus The menus from the public contract.
 * @return {Array<string>} The routes.
 */
export function routesFrom(menus) {
	const routes = []
	const push = (link) => {
		const route = String(link || '')
		if (route.startsWith('/') && routes.includes(route) === false) {
			routes.push(route)
		}
	}

	for (const menu of menus || []) {
		for (const item of (menu && menu.items) || []) {
			push(item.link)
			for (const child of item.items || []) {
				push(child.link)
			}
		}
	}

	return routes
}
