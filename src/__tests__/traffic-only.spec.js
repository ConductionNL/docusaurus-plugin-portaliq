/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin from '../index.js'

/**
 * A fetch that fails the test if it is ever called.
 *
 * The POINT of `content: false` is that no request is made, so a fetch that
 * records nothing would prove nothing: it has to refuse.
 *
 * @return {object} `{fetchImpl, calls}`.
 */
function forbiddenFetch() {
	const calls = []
	const fetchImpl = async (url) => {
		calls.push(url)
		throw new Error(`content API was called in traffic-only mode: ${url}`)
	}

	return { fetchImpl, calls }
}

/**
 * Collect what contentLoaded wrote.
 *
 * @return {object} `{actions, created, global}`.
 */
function recordingActions() {
	const created = {}
	let global = null
	const actions = {
		createData: async (name, value) => {
			created[name] = value
		},
		setGlobalData: (value) => {
			global = value
		},
	}

	return { actions, created, get global() {
		return global
	} }
}

test('content:false makes no request to the portal content API', async () => {
	const { fetchImpl, calls } = forbiddenFetch()
	const p = plugin({}, { baseUrl: 'https://portal.test', portal: 'demo', content: false, fetchImpl })

	const loaded = await p.loadContent()

	assert.deepEqual(calls, [], 'traffic-only mode must not fetch anything')
	assert.deepEqual(loaded, { site: null, menus: [], pages: [], glossary: null })
})

test('content:false still emits the traffic script tag', () => {
	const p = plugin({}, { baseUrl: 'https://portal.test', portal: 'demo', content: false })

	const tags = p.injectHtmlTags()

	assert.equal(tags.headTags.length, 1)
	assert.equal(
		tags.headTags[0].attributes.src,
		'https://portal.test/index.php/apps/portaliq/api/traffic-client.js',
	)
})

test('content:false writes empty docs rather than leaving them undefined', async () => {
	const p = plugin({}, { baseUrl: 'https://portal.test', portal: 'demo', content: false })
	const rec = recordingActions()

	await p.contentLoaded({ content: undefined, actions: rec.actions })

	assert.equal(rec.created['portaliq-docs.json'], '[]')
	assert.equal(rec.created['portaliq-glossary.json'], '[]')
	assert.deepEqual(rec.global, { site: null, sidebar: [], apiGaps: [] })
})

test('traffic:false with content:false emits nothing at all', () => {
	const p = plugin({}, { baseUrl: 'https://portal.test', portal: 'demo', content: false, traffic: false })

	assert.deepEqual(p.injectHtmlTags(), {})
})

test('content defaults to true, so an existing site keeps fetching', async () => {
	const { fetchImpl, calls } = forbiddenFetch()
	const p = plugin({}, { baseUrl: 'https://portal.test', portal: 'demo', fetchImpl })

	await assert.rejects(() => p.loadContent())
	assert.ok(calls.length > 0, 'the default must still reach the content API')
})
