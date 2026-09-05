# @conduction/docusaurus-plugin-portaliq

Build a [Docusaurus](https://docusaurus.io) site from a [Portaliq](https://github.com/ConductionNL/portaliq)
portal's **public content API** — and from nothing else.

Docusaurus is React; Portaliq's own renderer is Vue. Both consume the same
public contract, which is the point: the contract is the product, and two
independent renderers are how you find out whether it is sufficient.

## The conformance obligation

**A workaround here ends the headless property quietly.**

If this plugin needs something the public contract cannot supply, that is an
**API gap to report**, not a gap to route around. The moment it reads a database,
calls an admin route, or reconstructs something the contract should have given
it, the site keeps building and "the content API is sufficient without the
built-in renderer" silently stops being true — with nothing failing to say so.

Gaps are declared in `KNOWN_API_GAPS` (`src/index.js`), printed during every
build, and published in the site's global data, so they travel with the output
instead of living in somebody's memory.

The rule is enforced, not just documented: `ContentClient.get()` refuses any
request whose **resolved pathname** leaves `/api/content/`, and a test asks for
`../../../admin/settings` to prove it. (The first version checked the string
before `new URL()` normalised it, which let exactly that traversal through.)

## Usage

```js
// docusaurus.config.js
export default {
  plugins: [
    ['@conduction/docusaurus-plugin-portaliq', {
      baseUrl: 'https://portal.example',
      portal: 'my-portal',
      // Refuse to publish if the API returns less than this. Omit or set 0 to
      // skip the check for a resource.
      expected: { menus: 1, pages: 10, glossary: 0 },
      // A snapshot is NEVER a silent fallback — it is used only when enabled.
      snapshot: { enabled: false, content: null },
    }],
  ],
}
```

### Options

| Option | Meaning |
| --- | --- |
| `baseUrl` | The portal origin. Required. |
| `portal` | The portal slug, when the build host is not the portal's own host. |
| `appPath` | Route prefix. Defaults to `/index.php/apps/portaliq`. |
| `token` | Optional bearer. Never written to output or to a build log — including on a failed request, which is the path that serialises context. |
| `expected` | Minimum counts per resource. A shortfall fails the build **stating both numbers**. |
| `snapshot` | `{enabled, content}`. Only used when `enabled` is `true`, and it announces itself when it is. |
| `traffic` | Load the portal's traffic client. Defaults to `true`; `false` emits no tag at all. |

## Measurement

The built site loads the portal's **own** traffic client — a `<script>` pointing
at `{baseUrl}{appPath}/api/traffic-client.js` — rather than a copy vendored into
this package. That is deliberate: a statically built portal and a
server-rendered one must not be able to reach different conclusions about what a
visitor's browser may store, and the copy that drifted would be the one nobody
is watching.

**Two switches, both of which must be on.** `traffic: false` here emits no tag,
so nothing is fetched and nothing runs. Left on, the script still measures
nothing unless the portal itself has enabled it — the site's operator and the
portal's operator can be different people, and either may decline.

The script fetches the portal's settings **at runtime**, never at build time.
Baking them in is the shape that keeps measuring after an operator switches
measurement off; a privacy decision that needs a site rebuild to take effect is
a privacy decision that does not work.

Two things it will not do: it honours Do Not Track and Global Privacy Control
before anything else, and it writes nothing to browser storage until consent is
given where the portal requires it.

### What the client reports, and what it never does

The client is the same file the portal's own renderer loads, so the list below
is the portal's contract, documented at
`portaliq/docs/operations/traffic-analytics.md`; this is the short form.

- Page views (including in-page navigation), a session start, scrolling past
  90 %, outbound links, file downloads, site searches, form starts, field
  timings and abandons (field ids and durations only, never a value), missing
  pages (`data-portaliq-status="404"` on the not-found element) and script
  errors (message, file and line, never a stack or a query string).
- Visitors are counted cookieless by default: a daily salted hash, nothing in
  browser storage. A portal that switched on the persistent client id gets it
  only after consent, and `window.portaliqTraffic.consent(true|false)` is how a
  site's own banner reports that decision.
- `window.portaliqTraffic.track(name, params)` sends a custom event and
  `window.portaliqTraffic.dimension(id, value)` sets a custom dimension; the
  portal declares which events and dimensions it accepts and refuses the rest.
- A running experiment on a page assigns a variant per visitor and tags that
  visitor's events with it.
- Heatmaps (click positions as fractions, scroll depth) and session recording
  (a masked event stream: every text node reduced to its length, every input to
  its value length) exist only on a portal whose operator switched them on with
  the warning that goes with them, and recording never runs on a portal of kind
  `external`, because the site's DOM is not the portal's to record.

## What a build does

- **menus → sidebar.** Two-level nesting becomes a Docusaurus category. Deeper
  trees are not flattened silently.
- **pages → docs.** Markdown reaches Docusaurus's own MDX pipeline
  **unconverted** — running it through a second converter first is how a code
  fence or a table arrives broken.
- **glossary → data.** Published as `portaliq-glossary.json`.

## Why builds fail loudly

Silent content loss looks exactly like success: a build publishing three of
thirty pages is green and fast. So an unreachable API fails **naming the
endpoint**, a non-2xx fails with its status, and a shortfall against `expected`
fails with both counts. The zero-items case is covered explicitly, because an
empty successful response is the shape most easily mistaken for "nothing to
publish".

## Tests

```sh
npm test
```

No test-runner dependency: `node --test` is built in. The interesting cases are
the ones that assert a *property* rather than a return value — every outbound
request is intercepted and checked to be a public content call, and a token is
searched for in the built output and in a deliberately failed request.

## Licence

EUPL-1.2
