/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import plugin from '../index.js'
import { redact } from '../contentClient.js'

const TOKEN = 'sk-portal-SUPERSECRET-0123456789'

test('a configured token never reaches build output', async () => {
	const p = plugin({}, {
		baseUrl: 'https://portal.example',
		token: TOKEN,
		fetchImpl: async (url) => {
			const resource = new URL(url).pathname.split('/').pop()
			const bodies = {
				site: { title: 'Demo' },
				menus: { menus: [{ items: [{ name: 'Home', link: '/' }] }] },
				glossary: { terms: [] },
			}
			return { ok: true, status: 200, json: async () => bodies[resource] ?? { route: '/', body: { markdown: 'hi' } } }
		},
	})

	const content = await p.loadContent()
	const written = []
	let global = null
	await p.contentLoaded({
		content,
		actions: {
			createData: async (name, data) => written.push(data),
			setGlobalData: (data) => {
				global = data
			},
		},
	})

	const output = written.join('\n') + JSON.stringify(global)
	assert.equal(output.includes(TOKEN), false, 'the token reached build output')
	assert.equal(output.includes('SUPERSECRET'), false, 'part of the token reached build output')
})

test('a FAILED request does not leak the token — the path that serialises context', async () => {
	const p = plugin({}, {
		baseUrl: 'https://portal.example',
		token: TOKEN,
		// The failure message deliberately contains the token, the way a
		// library dumping request context would.
		fetchImpl: async () => {
			throw new Error(`connect failed for Authorization: Bearer ${TOKEN}`)
		},
	})

	await assert.rejects(
		() => p.loadContent(),
		(error) => {
			assert.equal(error.message.includes(TOKEN), false, 'the token leaked into a build error')
			assert.equal(error.message.includes('SUPERSECRET'), false, 'part of the token leaked')
			assert.match(error.message, /«redacted»/, 'the redaction was not applied')
			return true
		},
	)
})

test('redact removes every occurrence, and is a no-op without a token', () => {
	assert.equal(redact(`a ${TOKEN} b ${TOKEN}`, TOKEN), 'a «redacted» b «redacted»')
	assert.equal(redact('nothing to hide', ''), 'nothing to hide')
	assert.equal(redact(null, TOKEN), '')
})
