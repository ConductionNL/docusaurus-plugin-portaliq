/**
 * SPDX-FileCopyrightText: 2026 Conduction B.V. <info@conduction.nl>
 * SPDX-License-Identifier: EUPL-1.2
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { PortaliqBuildError } from './contentClient.js'

/**
 * Writing a portal's pages as Docusaurus docs, so Docusaurus's OWN docs
 * pipeline renders them.
 *
 * The pages go to disk as `.md` files with their markdown unconverted, and the
 * docs plugin picks them up like any hand-written doc: MDX, front matter, the
 * sidebar, versioning, search. Anything less — rendering the markdown here and
 * handing Docusaurus HTML — is the second converter the spec rules out, and the
 * place where a code fence or a table arrives broken.
 *
 * @spec openspec/changes/docusaurus-plugin-portaliq/specs/docusaurus-plugin-portaliq/spec.md#requirement-the-plugin-must-build-a-site-from-the-public-api-alone
 */

/** The file, inside `docsDir`, that lists what the previous build wrote. */
export const MANIFEST_FILE = '_portaliq-manifest.json'

/** The file, inside `docsDir`, that holds the sidebar for `sidebars.js`. */
export const SIDEBAR_FILE = '_portaliq-sidebar.json'

/**
 * The relative file path a doc id is written to.
 *
 * REFUSES A PATH THAT LEAVES `docsDir`. A page route comes from the portal,
 * and a route of `/../../src/pages/index` would otherwise overwrite a file the
 * site's own authors wrote. Every segment must be a plain name.
 *
 * @param {string} docId The doc id, e.g. `diensten/verhuizen`.
 * @return {string} The relative path, e.g. `diensten/verhuizen.md`.
 */
export function docFileFor(docId) {
	const segments = String(docId || '').split('/')
	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..' || segment.includes('\\') || segment.startsWith('_')) {
			throw new PortaliqBuildError(`portaliq: refused to write a doc outside docsDir: ${docId}`)
		}
	}

	return segments.join('/') + '.md'
}

/**
 * Quote a front-matter value as a YAML double-quoted string.
 *
 * JSON strings are valid YAML double-quoted scalars, so a title with a colon,
 * a quote or a newline cannot break the front matter.
 *
 * @param {string} value The value.
 * @return {string} The quoted value.
 */
function yamlString(value) {
	return JSON.stringify(String(value == null ? '' : value))
}

/**
 * The file content for one doc: front matter, then the markdown AS IS.
 *
 * @param {object} doc          The doc.
 * @param {string} doc.title    The page title.
 * @param {string} doc.route    The portal route, kept as the doc's slug.
 * @param {string} doc.markdown The page markdown.
 * @return {string} The file content.
 */
export function docSource({ title, route, markdown }) {
	return [
		'---',
		`title: ${yamlString(title)}`,
		`slug: ${yamlString(route || '/')}`,
		'---',
		'',
		String(markdown || ''),
	].join('\n')
}

/**
 * Read the files a previous build wrote; an absent or broken manifest is empty.
 *
 * @param {string} dir The docs directory.
 * @return {Promise<Array<string>>} The relative paths.
 */
async function previousFiles(dir) {
	try {
		const parsed = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'))
		return Array.isArray(parsed.files) ? parsed.files.map(String) : []
	} catch {
		return []
	}
}

/**
 * Write the docs and the sidebar into `dir`, and remove what a previous build
 * wrote that this one did not.
 *
 * A PAGE THE PORTAL NO LONGER SERVES MUST NOT STAY PUBLISHED. Without the
 * removal, a page deleted in the portal keeps its file here and the next build
 * quietly ships it again. Only files this plugin itself wrote (its manifest)
 * are removed — `dir` may hold docs the site's authors wrote by hand.
 *
 * @param {string} dir              The docs directory (absolute).
 * @param {object} content          The built content.
 * @param {Array}  content.docs     `{id, title, route, markdown}` per page.
 * @param {Array}  content.sidebar  The Docusaurus sidebar.
 * @return {Promise<Array<string>>} The relative paths written.
 */
export async function writeDocs(dir, { docs, sidebar }) {
	const root = resolve(dir)
	const written = []

	await mkdir(root, { recursive: true })
	for (const doc of docs || []) {
		const relative = docFileFor(doc.id)
		const target = resolve(root, relative)
		if (target.startsWith(root + sep) === false) {
			throw new PortaliqBuildError(`portaliq: refused to write a doc outside docsDir: ${doc.id}`)
		}

		await mkdir(dirname(target), { recursive: true })
		await writeFile(target, docSource(doc), 'utf8')
		written.push(relative)
	}

	for (const stale of await previousFiles(root)) {
		if (written.includes(stale)) {
			continue
		}

		const target = resolve(root, stale)
		// A manifest is a file on disk; it gets the same containment check.
		if (target.startsWith(root + sep) && target.endsWith('.md')) {
			await rm(target, { force: true })
		}
	}

	await writeFile(join(root, SIDEBAR_FILE), JSON.stringify(sidebar || [], null, 2), 'utf8')
	await writeFile(join(root, MANIFEST_FILE), JSON.stringify({ files: written }, null, 2), 'utf8')

	return written
}
