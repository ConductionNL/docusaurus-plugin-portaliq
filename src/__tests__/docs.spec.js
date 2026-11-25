/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import plugin, { docIdFor, routePath, trimSlashes } from '../index.js'
import { docFileFor, docSource, MANIFEST_FILE, SIDEBAR_FILE, writeDocs } from '../docsWriter.js'

const MARKDOWN = '# Title\n\n```js\nconst a = 1\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'

/**
 * A fetch answering a two-level menu, a page per route and a glossary.
 *
 * @param {Array<string>} routes The routes the menu points at.
 * @return {Function} The fetch.
 */
function portalFetch(routes) {
	return async (url) => {
		const parsed = new URL(url)
		const resource = parsed.pathname.split('/').pop()
		const route = parsed.searchParams.get('path')
		const bodies = {
			site: { title: 'Demo' },
			menus: {
				menus: [{
					items: [
						{ name: 'Home', link: routes[0] },
						{ name: 'Services', link: '/diensten', items: routes.slice(1).map((link) => ({ name: link, link })) },
					],
				}],
			},
			glossary: { terms: [{ term: 'Zaak', definition: 'A case.' }] },
			page: { route, title: `Page ${route}: "quoted"`, body: { markdown: MARKDOWN } },
		}

		return { ok: true, status: 200, json: async () => bodies[resource] }
	}
}

/**
 * A scratch directory, removed after the test.
 *
 * @param {object} t The test context.
 * @return {Promise<string>} The directory.
 */
async function scratch(t) {
	const dir = await mkdtemp(join(tmpdir(), 'portaliq-docs-'))
	t.after(() => rm(dir, { recursive: true, force: true }))

	return dir
}

test('with docsDir, every page is written as a doc with its markdown UNCONVERTED', async (t) => {
	const siteDir = await scratch(t)
	const fetchImpl = portalFetch(['/', '/diensten/verhuizen', '/diensten/afval'])

	const instance = await plugin({ siteDir, baseUrl: '/' }, { baseUrl: 'https://portal.example', docsDir: 'docs', fetchImpl })

	assert.equal(instance.name, 'docusaurus-plugin-portaliq')
	const home = await readFile(join(siteDir, 'docs', 'index.md'), 'utf8')
	const moving = await readFile(join(siteDir, 'docs', 'diensten', 'verhuizen.md'), 'utf8')
	// The markdown is byte-identical after the front matter: the fence and
	// the table reach Docusaurus's pipeline as the portal wrote them.
	assert.ok(home.endsWith('---\n\n' + MARKDOWN), 'the markdown was changed on its way to Docusaurus')
	assert.ok(moving.includes('slug: "/diensten/verhuizen"'))
	assert.ok(moving.includes('title: "Page /diensten/verhuizen: \\"quoted\\""'), 'a title with a colon and quotes must stay one YAML string')
	assert.ok(existsSync(join(siteDir, 'docs', 'diensten.md')))

	const sidebar = JSON.parse(await readFile(join(siteDir, 'docs', SIDEBAR_FILE), 'utf8'))
	assert.equal(sidebar[1].type, 'category')
	assert.deepEqual(sidebar[1].items.map((i) => i.id), ['diensten/verhuizen', 'diensten/afval'])
})

test('with docsDir the portal is fetched ONCE: loadContent reuses the constructor fetch', async (t) => {
	const siteDir = await scratch(t)
	const urls = []
	const inner = portalFetch(['/'])
	const fetchImpl = async (url) => {
		urls.push(url)
		return inner(url)
	}

	const instance = await plugin({ siteDir }, { baseUrl: 'https://portal.example', docsDir: 'docs', fetchImpl })
	const before = urls.length
	const content = await instance.loadContent()

	assert.equal(urls.length, before, 'loadContent fetched the portal a second time')
	assert.equal(content.pages.length, 2)
})

test('a page the portal no longer serves is removed; a hand-written doc stays', async (t) => {
	const siteDir = await scratch(t)
	await plugin({ siteDir }, { baseUrl: 'https://portal.example', docsDir: 'docs', fetchImpl: portalFetch(['/', '/diensten/verhuizen']) })
	await writeFile(join(siteDir, 'docs', 'handwritten.md'), '# Mine\n')

	await plugin({ siteDir }, { baseUrl: 'https://portal.example', docsDir: 'docs', fetchImpl: portalFetch(['/']) })

	assert.equal(existsSync(join(siteDir, 'docs', 'diensten', 'verhuizen.md')), false, 'a removed page was published again')
	assert.equal(existsSync(join(siteDir, 'docs', 'handwritten.md')), true, 'a doc this plugin did not write was removed')
	const manifest = JSON.parse(await readFile(join(siteDir, 'docs', MANIFEST_FILE), 'utf8'))
	assert.deepEqual(manifest.files.sort(), ['diensten.md', 'index.md'])
})

test('an unreachable API with docsDir fails the construction and writes nothing', async (t) => {
	const siteDir = await scratch(t)
	const fetchImpl = async () => {
		throw new Error('ECONNREFUSED')
	}

	await assert.rejects(
		plugin({ siteDir }, { baseUrl: 'https://portal.example', docsDir: 'docs', fetchImpl }),
		/cannot reach https:\/\/portal\.example/,
	)
	assert.equal(existsSync(join(siteDir, 'docs')), false)
})

test('a route that would leave docsDir is refused, not written', async () => {
	for (const id of ['../outside', 'a/../../b', 'a//b', '_hidden', 'a\\b']) {
		assert.throws(() => docFileFor(id), /refused to write a doc outside docsDir/, id)
	}
	assert.equal(docFileFor('diensten/verhuizen'), 'diensten/verhuizen.md')
})

test('writeDocs refuses a traversal even when called directly', async (t) => {
	const dir = await scratch(t)
	await assert.rejects(
		writeDocs(join(dir, 'docs'), { docs: [{ id: '../escape', title: 'x', route: '/x', markdown: 'x' }], sidebar: [] }),
		/refused/,
	)
	assert.equal(existsSync(join(dir, 'escape.md')), false)
})

test('a manifest pointing outside docsDir removes nothing outside it', async (t) => {
	const dir = await scratch(t)
	const docs = join(dir, 'docs')
	await writeDocs(docs, { docs: [], sidebar: [] })
	await writeFile(join(dir, 'keep.md'), 'keep')
	await writeFile(join(docs, MANIFEST_FILE), JSON.stringify({ files: ['../keep.md'] }))

	await writeDocs(docs, { docs: [], sidebar: [] })

	assert.equal(existsSync(join(dir, 'keep.md')), true)
})

test('without docsDir the plugin stays synchronous', () => {
	const instance = plugin({}, { baseUrl: 'https://portal.example', fetchImpl: portalFetch(['/']) })

	assert.equal(typeof instance.then, 'undefined')
	assert.equal(typeof instance.loadContent, 'function')
})

test('the glossary gets a route under the site base URL', async () => {
	const instance = plugin({ baseUrl: '/docs/' }, { baseUrl: 'https://portal.example', glossaryTitle: 'Begrippen', fetchImpl: portalFetch(['/']) })
	const content = await instance.loadContent()
	const routes = []
	const data = {}
	await instance.contentLoaded({
		content,
		actions: {
			createData: async (name, value) => {
				data[name] = value
				return `/generated/${name}`
			},
			setGlobalData: () => {},
			addRoute: (route) => routes.push(route),
		},
	})

	assert.deepEqual(routes, [{
		path: '/docs/glossary',
		component: '@theme/PortaliqGlossary',
		modules: { terms: '/generated/portaliq-glossary.json', title: '/generated/portaliq-glossary-title.json' },
		exact: true,
	}])
	assert.deepEqual(JSON.parse(data['portaliq-glossary.json']), [{ term: 'Zaak', definition: 'A case.' }])
	assert.equal(JSON.parse(data['portaliq-glossary-title.json']), 'Begrippen')
	assert.ok(existsSync(join(instance.getThemePath(), 'PortaliqGlossary', 'index.js')))
})

test('glossaryRoute:false and content:false add no route', async () => {
	for (const options of [{ glossaryRoute: false }, { content: false }]) {
		const instance = plugin({}, { baseUrl: 'https://portal.example', fetchImpl: portalFetch(['/']), ...options })
		const routes = []
		await instance.contentLoaded({
			content: await instance.loadContent(),
			actions: { createData: async () => '/x', setGlobalData: () => {}, addRoute: (r) => routes.push(r) },
		})
		assert.deepEqual(routes, [], JSON.stringify(options))
	}
})

test('routePath joins a base URL and a route without doubling slashes', () => {
	assert.equal(routePath('/', '/glossary'), '/glossary')
	assert.equal(routePath('/docs/', 'glossary'), '/docs/glossary')
	assert.equal(routePath(undefined, '/glossary'), '/glossary')
	// A long run of slashes is trimmed in linear time.
	const started = Date.now()
	assert.equal(routePath('/' + '/'.repeat(200000) + 'x', '/'.repeat(200000) + 'g'), '/' + '/'.repeat(200000) + 'x/g')
	assert.ok(Date.now() - started < 500)
})

test('docSource keeps front matter to title and slug', () => {
	assert.equal(docSource({ title: 'A', route: '/a', markdown: 'x' }), '---\ntitle: "A"\nslug: "/a"\n---\n\nx')
})

test('docIdFor and trimSlashes trim long slash runs in linear time', () => {
	const started = Date.now()
	assert.equal(docIdFor('/'.repeat(200000) + 'a/b' + '/'.repeat(200000)), 'a/b')
	assert.equal(docIdFor('/'.repeat(200000)), 'index')
	assert.equal(trimSlashes('//a//', true, false), 'a//')
	assert.equal(trimSlashes('//a//', false, true), '//a')
	assert.ok(Date.now() - started < 500)
})
