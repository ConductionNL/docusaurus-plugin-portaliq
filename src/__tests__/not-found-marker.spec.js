/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import plugin from '../index.js'

/**
 * The traffic client cannot read an HTTP status: it runs inside a page that
 * has already been served, so a 404 and a real page look the same to it. Its
 * answer is a DOM marker, `data-portaliq-status="404"`, which it watches for
 * and turns into a `page_not_found` event instead of a `page_view`.
 *
 * Measured on conduction.nl, 2026-09-22: nothing rendered that marker, so 34
 * of 162 stored events were malformed paths counted as real page views, and
 * they ranked second in the top-pages table.
 */

const OPTIONS = { baseUrl: 'https://portal.test', portal: 'example', traffic: true, content: false }

test('the plugin ships a theme directory that actually exists', () => {
	const themePath = plugin({ siteDir: '.' }, OPTIONS).getThemePath()

	assert.ok(path.isAbsolute(themePath), 'getThemePath must be absolute, or Docusaurus resolves it against the consuming site and finds nothing')
	assert.ok(fs.existsSync(themePath), `theme path does not exist: ${themePath}`)
})

test('the 404 content component carries the marker the client watches for', () => {
	const themePath = plugin({ siteDir: '.' }, OPTIONS).getThemePath()
	const component = path.join(themePath, 'NotFound', 'Content.js')

	assert.ok(fs.existsSync(component), 'NotFound/Content.js must be shipped')

	const source = fs.readFileSync(component, 'utf8')
	assert.match(source, /data-portaliq-status="404"/, 'the marker attribute and value must match what the client queries for')
	// @theme-init, not @theme-original: a plugin SHADOWS the component, and
	// @theme-original resolves back to this same file. The build then dies on
	// /404.html with "Maximum call stack size exceeded".
	assert.match(source, /@theme-init\/NotFound\/Content/, 'the original 404 must still render, or this plugin replaces every site\'s 404 with a blank page')
	// Narrowed to the IMPORT. A bare /@theme-original/ also matches the
	// comment above it, which exists precisely to explain why not to use it,
	// so the guard failed on the documentation rather than on the code.
	assert.doesNotMatch(source, /from '@theme-original/, '@theme-original recurses from a plugin-provided theme')
})

test('the theme is offered even when traffic is switched off', () => {
	// The marker is inert without the client. Making the theme path
	// conditional would mean a site that turns measurement on LATER keeps
	// counting its 404s as page views until somebody remembers why.
	const off = plugin({ siteDir: '.' }, { ...OPTIONS, traffic: false })

	assert.equal(typeof off.getThemePath, 'function')
	assert.ok(fs.existsSync(off.getThemePath()))
	assert.deepEqual(off.injectHtmlTags(), {}, 'traffic: false must still emit no script tag')
})
