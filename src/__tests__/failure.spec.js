/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin from '../index.js'
import { assertAtLeast, ContentClient, PortaliqBuildError } from '../contentClient.js'

const OK = {
	site: { title: 'Demo' },
	menus: { menus: [{ items: [{ name: 'Home', link: '/' }] }] },
	glossary: { terms: [{ term: 'Zaak' }] },
	page: { route: '/', title: 'Home', body: { markdown: 'hi' } },
}

/**
 * @param {object} fixtures Fixture bodies by resource.
 * @return {Function} A fetch implementation.
 */
function fetchFrom(fixtures) {
	return async (url) => {
		const resource = new URL(url).pathname.split('/').pop()
		const body = fixtures[resource] ?? fixtures.page
		return { ok: true, status: 200, json: async () => body }
	}
}

test('an unreachable API fails the build and NAMES the endpoint', async () => {
	const p = plugin({}, {
		baseUrl: 'https://portal.example',
		fetchImpl: async () => {
			throw new Error('ECONNREFUSED')
		},
	})

	await assert.rejects(
		() => p.loadContent(),
		(error) => {
			assert.ok(error instanceof PortaliqBuildError)
			assert.match(error.message, /portal\.example/, 'the endpoint was not named')
			assert.match(error.message, /api\/content/, 'the path was not named')
			return true
		},
	)
})

test('a non-2xx response fails the build with its status', async () => {
	const p = plugin({}, {
		baseUrl: 'https://portal.example',
		fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
	})

	await assert.rejects(() => p.loadContent(), /503/)
})

test('fewer items than expected fails the build stating BOTH counts', () => {
	// Silent content loss is the failure that looks exactly like success, so the
	// message has to be arithmetic rather than adjectival.
	assert.throws(
		() => assertAtLeast('pages', 3, 30),
		(error) => {
			assert.match(error.message, /at least 30/)
			assert.match(error.message, /received 3/)
			return true
		},
	)
})

test('an unchecked expectation lets a legitimately empty portal build', () => {
	assert.doesNotThrow(() => assertAtLeast('pages', 0, 0))
})

test('ZERO items against an expectation still fails — the shape most like success', () => {
	assert.throws(() => assertAtLeast('glossary', 0, 1), /received 0/)
})

test('a snapshot is used ONLY when explicitly enabled', async () => {
	const failing = async () => {
		throw new Error('down')
	}

	const withoutSnapshot = plugin({}, { baseUrl: 'https://portal.example', fetchImpl: failing })
	await assert.rejects(() => withoutSnapshot.loadContent(), PortaliqBuildError)

	// Present but not enabled is still a failure: a snapshot that steps in
	// because it happens to exist publishes stale content nobody chose.
	const present = plugin({}, {
		baseUrl: 'https://portal.example',
		fetchImpl: failing,
		snapshot: { enabled: false, content: { site: {}, menus: [], pages: [], glossary: {} } },
	})
	await assert.rejects(() => present.loadContent(), PortaliqBuildError)

	const enabled = plugin({}, {
		baseUrl: 'https://portal.example',
		fetchImpl: failing,
		snapshot: { enabled: true, content: { site: { title: 'cached' }, menus: [], pages: [], glossary: {} } },
	})
	const content = await enabled.loadContent()
	assert.equal(content.site.title, 'cached')
})

test('a healthy build meeting its expectations succeeds', async () => {
	const p = plugin({}, {
		baseUrl: 'https://portal.example',
		fetchImpl: fetchFrom(OK),
		expected: { menus: 1, pages: 1, glossary: 1 },
	})

	const content = await p.loadContent()
	assert.equal(content.pages.length, 1)
})

test('the client refuses a resource outside the public content API', async () => {
	const client = new ContentClient({ baseUrl: 'https://portal.example', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) })
	// The prefix is applied by the client, so a caller cannot escape it by
	// naming a path — the attempt lands inside `/api/content/` or throws.
	const urls = []
	client.fetchImpl = async (url) => {
		urls.push(url)
		return { ok: true, status: 200, json: async () => ({}) }
	}

	// A traversal must be REFUSED, not normalised into a request that leaves the
	// public surface. `new URL()` resolves `..` happily, which is exactly why
	// the guard inspects the resolved pathname.
	await assert.rejects(
		() => client.get('../../../admin/settings'),
		/refused a request outside the public content API/,
	)
	assert.equal(urls.length, 0, 'a refused request must never be sent')
})
