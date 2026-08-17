/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin, { docIdFor, markdownFor, sidebarFrom, trafficScriptTag } from '../index.js'

/**
 * A fetch that records every URL and answers from a fixture.
 *
 * The RECORDING is the point: this plugin's architectural value is that it
 * cannot reach an internal API, and that is a property of the requests a build
 * makes — not of the code somebody read.
 *
 * @param {object} fixtures Keyed by resource name.
 * @return {object} `{fetchImpl, urls}`.
 */
function recordingFetch(fixtures) {
	const urls = []
	const fetchImpl = async (url) => {
		urls.push(url)
		const resource = new URL(url).pathname.split('/').pop()
		const body = fixtures[resource] ?? fixtures.page
		return { ok: true, status: 200, json: async () => body }
	}

	return { fetchImpl, urls }
}

const FIXTURES = {
	site: { title: 'Demo', slug: 'demo' },
	menus: {
		menus: [
			{
				title: 'Main',
				items: [
					{ name: 'Home', link: '/' },
					{
						name: 'Services',
						link: '/diensten',
						items: [
							{ name: 'Moving', link: '/diensten/verhuizen' },
							{ name: 'Waste', link: '/diensten/afval' },
						],
					},
				],
			},
		],
	},
	glossary: { terms: [{ term: 'Zaak', definition: 'A case.' }] },
	page: {
		route: '/',
		title: 'Home',
		body: { markdown: '# Title\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n' },
	},
}

test('every outbound request is a public content API call', async () => {
	const { fetchImpl, urls } = recordingFetch(FIXTURES)
	const p = plugin({}, { baseUrl: 'https://portal.example', portal: 'demo', fetchImpl })

	await p.loadContent()

	assert.ok(urls.length > 0, 'the build made no requests at all')
	for (const url of urls) {
		assert.match(
			new URL(url).pathname,
			/\/api\/content\//,
			`a build request left the public content API: ${url}`,
		)
	}
})

test('a two-level menu becomes a sidebar category', () => {
	const sidebar = sidebarFrom(FIXTURES.menus.menus)

	assert.equal(sidebar.length, 2)
	assert.equal(sidebar[0].type, 'doc')
	assert.equal(sidebar[1].type, 'category')
	assert.equal(sidebar[1].label, 'Services')
	assert.deepEqual(
		sidebar[1].items.map((i) => i.id),
		['diensten/verhuizen', 'diensten/afval'],
	)
})

test('the root route becomes the index document', () => {
	assert.equal(docIdFor('/'), 'index')
	assert.equal(docIdFor('/begrippen'), 'begrippen')
	assert.equal(docIdFor('/diensten/afval/'), 'diensten/afval')
})

test('markdown reaches Docusaurus unconverted — a fence and a table survive', () => {
	const md = markdownFor(FIXTURES.page)

	assert.ok(md.includes('```js'), 'the code fence was altered')
	assert.ok(md.includes('const a = 1'), 'the fenced code was altered')
	assert.ok(md.includes('| a | b |'), 'the table was altered')
	assert.equal(md, FIXTURES.page.body.markdown, 'the markdown was not passed through verbatim')
})

test('a grid page contributes its markdown blocks in order', () => {
	const md = markdownFor({
		body: {
			type: 'grid',
			widgets: [
				{ widgetKey: 'markdown', props: { markdown: 'first' } },
				{ widgetKey: 'hero', props: { title: 'not markdown' } },
				{ widgetKey: 'markdown', props: { markdown: 'second' } },
			],
		},
	})

	assert.equal(md, 'first\n\nsecond')
})

test('the traffic script is loaded FROM THE PORTAL, not bundled here', () => {
	const tag = trafficScriptTag({
		baseUrl: 'https://portal.example/',
		appPath: '/index.php/apps/portaliq',
		portal: 'demo',
	})

	assert.equal(tag.tagName, 'script')
	// THE ROUTE, NOT THE FILE PATH. `<app>/js/portaliq-traffic.js` answers 401
	// to an anonymous caller — measured, 43 bytes of JSON — and the path that
	// does serve it varies by deployment. A built site bakes this URL in and
	// cannot be corrected later, so it has to be the stable one.
	assert.equal(
		tag.attributes.src,
		'https://portal.example/index.php/apps/portaliq/api/traffic-client.js',
	)
	assert.doesNotMatch(tag.attributes.src, /\/js\//, 'the tag points at a deployment-dependent file path')

	// THE SOURCE IS THE ASSERTION. Vendoring a copy of the client into this
	// package would let a statically built portal and a server-rendered one
	// reach different conclusions about what a visitor's browser may store,
	// and the copy that drifted would be the one nobody is watching.
	assert.match(tag.attributes.src, /^https:\/\/portal\.example\//)
	assert.equal(tag.attributes['data-portal'], 'demo')
	assert.equal(tag.attributes.defer, true)
})

test('a site can decline measurement outright', () => {
	const on = plugin({}, { baseUrl: 'https://portal.example', portal: 'demo' })
	const off = plugin({}, { baseUrl: 'https://portal.example', portal: 'demo', traffic: false })

	assert.equal(on.injectHtmlTags().headTags.length, 1)

	// Not a hint, an off switch: no tag means nothing is fetched and nothing
	// runs, rather than a script that loads and then decides to be quiet.
	assert.deepEqual(off.injectHtmlTags(), {})
})

test('the build reports its API gaps rather than working around them', async () => {
	const { fetchImpl } = recordingFetch(FIXTURES)
	const p = plugin({}, { baseUrl: 'https://portal.example', fetchImpl })
	const content = await p.loadContent()

	let global = null
	const created = []
	await p.contentLoaded({
		content,
		actions: {
			createData: async (name, data) => created.push([name, data]),
			setGlobalData: (data) => {
				global = data
			},
		},
	})

	assert.ok(global.apiGaps.length > 0, 'no gaps were reported')
	for (const gap of global.apiGaps) {
		assert.ok(gap.name && gap.why, 'a gap must name itself and say why')
	}
	assert.deepEqual(
		created.map(([name]) => name),
		['portaliq-docs.json', 'portaliq-glossary.json'],
	)
})
