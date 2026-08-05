/**
 * Generates the Next.js App Router tree from the Framer static export.
 *
 * The export is Framer-SSR'd HTML hydrated by Framer's own compiled React
 * runtime, so the markup itself must survive byte-for-byte. What this script
 * does is lift the parts that *are* expressible as Next.js code -- page
 * metadata, stylesheet ordering, script loading -- into real framework
 * constructs, and pass the Framer subtree through untouched.
 *
 * Run with: npm run generate
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NEXT_ROOT = path.resolve(HERE, '..')
const EXPORT_ROOT = path.resolve(NEXT_ROOT, '..')
const APP_DIR = path.join(NEXT_ROOT, 'app')

/** Source html file -> clean route path. */
const ROUTES = {
  'index.html': '/',
  'contact.html': '/contact',
  'our-company.html': '/our-company',
  'privacy-policy.html': '/privacy-policy',
  'terms-of-use.html': '/terms-of-use',
  'our-tech/amrv.html': '/our-tech/amrv',
  'our-tech/blockchain.html': '/our-tech/blockchain',
  'solutions/nature-based.html': '/solutions/nature-based',
  'solutions/supply-chain.html': '/solutions/supply-chain',
  'resources/case-studies.html': '/resources/case-studies',
  'resources/news-and-media.html': '/resources/news-and-media',
  'resources/research-and-insights.html': '/resources/research-and-insights',
  'resources/case-studies/scaling-alethias-intelligence-with-ai.html':
    '/resources/case-studies/scaling-alethias-intelligence-with-ai',
  'resources/case-studies/turning-regenerative-ag-into-verified-climate-performance.html':
    '/resources/case-studies/turning-regenerative-ag-into-verified-climate-performance',
  'resources/news-and-media/alethias-atmospheric-based-measurement-reporting-and-verification-approach.html':
    '/resources/news-and-media/alethias-atmospheric-based-measurement-reporting-and-verification-approach',
}

// --------------------------------------------------------------------------
// HTML helpers
// --------------------------------------------------------------------------

const VOID_TAGS = new Set(['meta', 'link', 'br', 'img', 'source', 'base'])

function splitDocument(html) {
  const headStart = html.indexOf('<head>') + '<head>'.length
  const headEnd = html.indexOf('</head>')
  const bodyStart = html.indexOf('<body>') + '<body>'.length
  const bodyEnd = html.lastIndexOf('</body>')
  return { head: html.slice(headStart, headEnd), body: html.slice(bodyStart, bodyEnd) }
}

/**
 * Walks the top-level nodes of a fragment. Deliberately minimal -- the Framer
 * head only contains meta/link/style/script/title/comments at the top level,
 * never nested elements.
 */
function parseNodes(fragment) {
  const nodes = []
  let pos = 0
  while (pos < fragment.length) {
    const lt = fragment.indexOf('<', pos)
    if (lt === -1) break

    if (fragment.startsWith('<!--', lt)) {
      const end = fragment.indexOf('-->', lt) + 3
      nodes.push({ type: 'comment', raw: fragment.slice(lt, end) })
      pos = end
      continue
    }

    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(fragment.slice(lt))
    if (!nameMatch) { pos = lt + 1; continue }

    const tag = nameMatch[1].toLowerCase()
    const gt = findTagEnd(fragment, lt)
    const openTag = fragment.slice(lt, gt + 1)
    const attrs = parseAttrs(openTag.slice(tag.length + 1, openTag.endsWith('/>') ? -2 : -1))

    if (VOID_TAGS.has(tag)) {
      nodes.push({ type: 'element', tag, attrs, inner: '' })
      pos = gt + 1
    } else {
      const closeIdx = fragment.indexOf(`</${tag}>`, gt)
      const inner = closeIdx === -1 ? '' : fragment.slice(gt + 1, closeIdx)
      nodes.push({ type: 'element', tag, attrs, inner })
      pos = closeIdx === -1 ? gt + 1 : closeIdx + tag.length + 3
    }
  }
  return nodes
}

/** Finds the '>' that closes an open tag, skipping quoted attribute values. */
function findTagEnd(s, start) {
  let quote = null
  for (let i = start + 1; i < s.length; i++) {
    const ch = s[i]
    if (quote) { if (ch === quote) quote = null }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return s.length - 1
}

function parseAttrs(str) {
  const attrs = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(str))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

function decodeEntities(s) {
  return s
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Asset references are passed through exactly as the export wrote them --
 * document-relative, including the "../" prefixes deep pages use.
 *
 * They are deliberately NOT rewritten to root-absolute. The site is served
 * from a subpath on GitHub Pages (/alethia-next/), where "/images/x.png"
 * would 404; the original relative form resolves correctly under any base,
 * because each route sits at the same directory depth as the .html file it
 * replaces. It also keeps the markup byte-identical to the export.
 */
function assetRef(ref) {
  return ref
}

// --------------------------------------------------------------------------
// Head partitioning: Next.js metadata vs. passthrough
// --------------------------------------------------------------------------

function partitionHead(headHtml) {
  const nodes = parseNodes(headHtml)
  const meta = { icons: { light: null, dark: null }, twitter: {}, og: {} }
  const extras = []

  for (const node of nodes) {
    if (node.type === 'comment') continue
    const { tag, attrs } = node

    if (tag === 'title') { meta.title = decodeEntities(node.inner); continue }

    if (tag === 'meta') {
      if (attrs.charset !== undefined) continue // Next emits the charset itself
      const { name, property } = attrs
      const content = decodeEntities(attrs.content ?? '')
      if (name === 'viewport') { meta.viewport = content; continue }
      if (name === 'description') { meta.description = content; continue }
      if (name === 'generator') { meta.generator = content; continue }
      if (name === 'robots') { meta.robots = content; continue }
      // Image URLs stay raw meta tags. Routing them through the metadata API
      // would make Next resolve them against `metadataBase`, turning them into
      // absolute URLs against whatever origin happens to be building -- the dev
      // server, or a Pages subpath. A raw tag keeps the export's own value.
      if (name === 'twitter:image' || property === 'og:image') {
        extras.push({ kind: 'void', tag: 'meta', attrs: { ...attrs, content: assetRef(attrs.content) } })
        continue
      }
      if (name?.startsWith('twitter:')) { meta.twitter[name.slice(8)] = content; continue }
      if (property?.startsWith('og:')) { meta.og[property.slice(3)] = content; continue }
      extras.push({ kind: 'void', tag: 'meta', attrs })
      continue
    }

    if (tag === 'link') {
      if (attrs.rel === 'icon') {
        meta.icons[/dark/.test(attrs.media ?? '') ? 'dark' : 'light'] = assetRef(attrs.href)
        continue
      }
      if (attrs.rel === 'canonical') { meta.canonical = attrs.href; continue }
      extras.push({ kind: 'void', tag: 'link', attrs: { ...attrs, href: assetRef(attrs.href) } })
      continue
    }

    if (tag === 'style') { extras.push({ kind: 'style', attrs, css: node.inner }); continue }

    if (tag === 'script') {
      if (attrs.src) extras.push({ kind: 'script-src', attrs: { ...attrs, src: assetRef(attrs.src) } })
      else extras.push({ kind: 'script-inline', code: node.inner })
    }
  }
  return { meta, extras }
}

// --------------------------------------------------------------------------
// Body partitioning
// --------------------------------------------------------------------------

function partitionBody(bodyHtml) {
  const mainIdx = bodyHtml.indexOf('<div id="main"')
  if (mainIdx === -1) throw new Error('no #main element found')

  // #main must remain a direct child of <body>: the Framer cascade and its
  // height chain depend on it, so the element is rebuilt as a real React node
  // carrying its original attributes, with only its children injected.
  const openEnd = findTagEnd(bodyHtml, mainIdx)
  const mainAttrs = parseAttrs(bodyHtml.slice(mainIdx + '<div'.length, openEnd))
  const closeIdx = bodyHtml.lastIndexOf('</div>')

  // Asset URLs inside #main are left exactly as exported. The Framer bundles
  // re-render these nodes during hydration using the same relative strings, so
  // rewriting them here ("images/x" -> "/images/x") makes every one of those
  // nodes mismatch and tears down the hydrated tree. Relative paths resolve
  // identically anyway: each clean route sits at the same directory depth as
  // the .html file it replaces.
  const mainInner = bodyHtml.slice(openEnd + 1, closeIdx)

  // Scripts before #main have to keep executing, so they stay real elements.
  const preScripts = parseNodes(bodyHtml.slice(0, mainIdx))
    .filter((n) => n.type === 'element' && n.tag === 'script')
    .map((n) => ({
      attrs: { ...n.attrs, ...(n.attrs.src ? { src: assetRef(n.attrs.src) } : {}) },
    }))

  return { preScripts, mainAttrs, mainInner }
}

// --------------------------------------------------------------------------
// Emitters
// --------------------------------------------------------------------------

const js = (v) => JSON.stringify(v)

/**
 * React treats these as boolean DOM properties: passing "" makes React drop
 * the attribute entirely, which would silently change how the script loads.
 */
const BOOLEAN_ATTRS = new Set(['async', 'defer', 'nomodule'])

/** React only recognises these in camelCase; the lowercase form warns. */
const ATTR_RENAMES = { crossorigin: 'crossOrigin', fetchpriority: 'fetchPriority', charset: 'charSet' }

/**
 * Emits attributes as a spread of literal HTML attribute names. React passes
 * unrecognised attributes through verbatim, which keeps the rendered markup
 * identical to the export instead of camelCasing it. Valueless attributes are
 * emitted as "" so they render bare, matching the export.
 */
function spreadAttrs(attrs, extra = '') {
  const pairs = Object.entries(attrs).map(([rawKey, v]) => {
    const k = ATTR_RENAMES[rawKey] ?? rawKey
    if (v === '') return `${js(k)}: ${BOOLEAN_ATTRS.has(k) ? 'true' : '""'}`
    return `${js(k)}: ${js(v)}`
  })
  return `{...{${pairs.join(', ')}}}${extra}`
}

function renderMetadata(meta) {
  const lines = [`  title: ${js(meta.title ?? '')},`]
  if (meta.description) lines.push(`  description: ${js(meta.description)},`)
  if (meta.generator) lines.push(`  generator: ${js(meta.generator)},`)
  if (meta.robots) lines.push(`  robots: ${js(meta.robots)},`)
  if (meta.canonical) lines.push(`  alternates: { canonical: ${js(meta.canonical)} },`)

  const icons = []
  if (meta.icons.light) icons.push(`      { url: ${js(meta.icons.light)}, media: "(prefers-color-scheme: light)" },`)
  if (meta.icons.dark) icons.push(`      { url: ${js(meta.icons.dark)}, media: "(prefers-color-scheme: dark)" },`)
  if (icons.length) lines.push(`  icons: {\n    icon: [\n${icons.join('\n')}\n    ],\n  },`)

  if (Object.keys(meta.og).length) {
    const og = []
    if (meta.og.type) og.push(`    type: ${js(meta.og.type)},`)
    if (meta.og.title) og.push(`    title: ${js(meta.og.title)},`)
    if (meta.og.description) og.push(`    description: ${js(meta.og.description)},`)
    if (meta.og.url) og.push(`    url: ${js(meta.og.url)},`)
    lines.push(`  openGraph: {\n${og.join('\n')}\n  },`)
  }
  if (Object.keys(meta.twitter).length) {
    const tw = []
    if (meta.twitter.card) tw.push(`    card: ${js(meta.twitter.card)},`)
    if (meta.twitter.title) tw.push(`    title: ${js(meta.twitter.title)},`)
    if (meta.twitter.description) tw.push(`    description: ${js(meta.twitter.description)},`)
    lines.push(`  twitter: {\n${tw.join('\n')}\n  },`)
  }
  return `export const metadata: Metadata = {\n${lines.join('\n')}\n}`
}

function renderViewport(meta) {
  const raw = meta.viewport ?? ''
  const width = /width=device-width/.test(raw) ? "'device-width'" : js(raw)
  const lines = [`  width: ${width},`]
  // Next defaults initialScale to 1 and merges it in. The export ships
  // `width=device-width` alone, and adding initial-scale=1 changes zoom and
  // rotation behaviour on mobile, so it is explicitly suppressed.
  if (!/initial-scale/.test(raw)) {
    lines.push('  initialScale: null as unknown as undefined,')
  } else {
    lines.push(`  initialScale: ${parseFloat(/initial-scale=([\d.]+)/.exec(raw)[1])},`)
  }
  return `export const viewport: Viewport = {\n${lines.join('\n')}\n}`
}

/** Head passthrough nodes -> JSX. React 19 hoists these into <head>. */
function renderExtras(extras, routeKey) {
  const out = []
  let styleSeq = 0
  for (const node of extras) {
    if (node.kind === 'void') {
      out.push(`      <${node.tag} ${spreadAttrs(node.attrs)} />`)
    } else if (node.kind === 'style') {
      // `href` + `precedence` make React 19 hoist the tag into <head>; tags
      // sharing a precedence keep render order, which the cascade depends on.
      const key = `${routeKey}-${styleSeq++}`
      out.push(
        `      <style href=${js(key)} precedence="framer" ${spreadAttrs(node.attrs)}\n` +
        `        dangerouslySetInnerHTML={{ __html: ${js(node.css)} }} />`,
      )
    } else if (node.kind === 'script-src') {
      out.push(`      <script ${spreadAttrs(node.attrs)} />`)
    } else if (node.kind === 'script-inline') {
      out.push(`      <script dangerouslySetInnerHTML={{ __html: ${js(node.code)} }} />`)
    }
  }
  return out.join('\n')
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function main() {
  let count = 0
  for (const [file, route] of Object.entries(ROUTES)) {
    const html = fs.readFileSync(path.join(EXPORT_ROOT, file), 'utf8')
    const { head, body } = splitDocument(html)
    const { meta, extras } = partitionHead(head)
    const { preScripts, mainAttrs, mainInner } = partitionBody(body)

    const routeKey = route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')
    const dir = route === '/' ? APP_DIR : path.join(APP_DIR, route.slice(1))
    fs.mkdirSync(dir, { recursive: true })

    // The subtree runs to ~525KB, so it ships as JSON beside the route rather
    // than as a giant literal inside the component.
    fs.writeFileSync(path.join(dir, 'framer.json'), JSON.stringify({ html: mainInner }), 'utf8')

    const preScriptJsx = preScripts.map((s) => `      <script ${spreadAttrs(s.attrs)} />`).join('\n')

    const page = `import type { Metadata, Viewport } from 'next'
import framer from './framer.json'

${renderMetadata(meta)}

${renderViewport(meta)}

export default function Page() {
  return (
    <>
${renderExtras(extras, routeKey)}
${preScriptJsx}
      {/* Framer-rendered subtree, passed through verbatim so the compiled
          Framer runtime hydrates exactly the tree it was built against. */}
      <div ${spreadAttrs(mainAttrs)} suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: framer.html }} />
    </>
  )
}
`
    fs.writeFileSync(path.join(dir, 'page.tsx'), page, 'utf8')
    count++
    process.stdout.write(`  ${route.padEnd(72)} <- ${file}\n`)
  }
  process.stdout.write(`\nGenerated ${count} routes into app/\n`)
}

main()
