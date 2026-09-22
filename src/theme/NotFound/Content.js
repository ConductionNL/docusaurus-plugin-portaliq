// SPDX-License-Identifier: EUPL-1.2
// Copyright (C) 2026 Conduction B.V.

import React from 'react'
import Content from '@theme-init/NotFound/Content'

/**
 * The 404 page, with the marker that tells the traffic client this route
 * does not exist.
 *
 * WHY THIS EXISTS
 *
 * The traffic client cannot see an HTTP status. It runs inside a page that
 * has already been served, so a 404 and a real page look identical to it
 * and both are recorded as `page_view`. The client's own answer is a DOM
 * marker: it watches for `data-portaliq-status="404"` and records
 * `page_not_found` instead. Nothing rendered that marker, so nothing ever
 * emitted the event.
 *
 * Measured on conduction.nl, 2026-09-22. Of 162 stored traffic events, 34
 * carried malformed paths from one visitor in a two minute burst, and they
 * ranked SECOND in the top-pages table at 17 views each, above /apps/. The
 * report presented a mangled URL as one of the most visited pages on the
 * site.
 *
 * NOT COUNTED, BUT STILL STORED. `page_not_found` events stay in the
 * register and the rollup already aggregates them into its `notFound`
 * dimension, which is what turns junk traffic into a list of broken links
 * worth fixing. Dropping the events instead would have thrown that away.
 *
 * `@theme-init`, NOT `@theme-original`. `@theme-original` is for a component
 * swizzled into a SITE's own src/theme. A plugin that ships a theme path is
 * shadowing the component, and Docusaurus exposes the shadowed original as
 * `@theme-init`. Importing `@theme-original` here resolves back to this same
 * file: the build fails on /404.html with `RangeError: Maximum call stack
 * size exceeded`, which names the symptom and nothing else.
 *
 * The path is deliberately NOT set as an attribute here. Doing so needs
 * `window` at render time, which differs between the server build and the
 * browser and costs a hydration mismatch. The event carries `pagePath` and
 * `pageLocation` anyway, and the rollup reads those as fallbacks, so the
 * broken path is attributed either way.
 *
 * @param {object} props Whatever the theme passes the original.
 * @return {JSX.Element} The original 404 content, marked.
 */
export default function NotFoundContent(props) {
	return (
		<>
			<div data-portaliq-status="404" hidden />
			<Content {...props} />
		</>
	)
}
