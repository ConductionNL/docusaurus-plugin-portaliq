/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import React from 'react'
import Layout from '@theme/Layout'

/**
 * The glossary route: the portal's glossary terms as a definition list.
 *
 * Plain `React.createElement`, no JSX, so the file needs no transpiling of its
 * own. A site restyles or replaces it by swizzling `PortaliqGlossary`.
 *
 * @spec openspec/changes/docusaurus-plugin-portaliq/specs/docusaurus-plugin-portaliq/spec.md#requirement-the-plugin-must-build-a-site-from-the-public-api-alone
 *
 * @param {object} props       The route props.
 * @param {Array}  props.terms The glossary terms, `{term, definition}`.
 * @param {string} props.title The page title (option `glossaryTitle`).
 * @return {object} The page.
 */
export default function PortaliqGlossary({ terms = [], title = 'Glossary' }) {
	const h = React.createElement
	const list = Array.isArray(terms) ? terms : []

	return h(
		Layout,
		{ title: String(title) },
		h(
			'main',
			{ className: 'container margin-vert--lg' },
			h('h1', null, String(title)),
			h(
				'dl',
				null,
				list.flatMap((entry, index) => [
					h('dt', { key: `t${index}`, id: slugFor(entry && entry.term) }, String((entry && entry.term) || '')),
					h('dd', { key: `d${index}` }, String((entry && entry.definition) || '')),
				]),
			),
		),
	)
}

/**
 * An anchor for a term, so a page can link to `/glossary#zaak`.
 *
 * @param {string} term The term.
 * @return {string} The anchor.
 */
function slugFor(term) {
	return String(term || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
