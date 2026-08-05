/**
 * Removes the RSC prefetch payloads from the static export.
 *
 * Next writes a `<route>.txt` payload plus a `<route>/__next.*.txt` directory
 * for every page, used when the client router navigates. This site never does
 * client-side navigation -- every link is a plain <a href> inside the Framer
 * markup, so each click is a full page load -- which makes the payloads dead
 * weight, and worse: the `contact/` directory sitting next to `contact.html`
 * makes the clean URL `/contact` ambiguous on a static host, where it can
 * resolve to the directory and redirect to `/contact/`. That trailing slash
 * would change the document base and break every relative asset reference.
 *
 * Run with: npm run prune-export  (wired into `npm run build`)
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out')

let removedFiles = 0
let removedDirs = 0
let bytes = 0

async function walk(dir) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    // Never touch Next's own asset output.
    if (entry.isDirectory() && entry.name === '_next' && dir === OUT) continue

    if (entry.isDirectory()) {
      await walk(full)
      const rest = await fs.readdir(full)
      if (rest.length === 0) {
        await fs.rmdir(full)
        removedDirs++
      }
    } else if (entry.name.endsWith('.txt')) {
      // `__next.*.txt` are prefetch payloads; `<route>.txt` is the flight
      // payload for that route. Both are only read by the client router.
      const isPayload = entry.name.startsWith('__next.') || await hasSiblingHtml(dir, entry.name)
      if (isPayload) {
        bytes += (await fs.stat(full)).size
        await fs.unlink(full)
        removedFiles++
      }
    }
  }
}

async function hasSiblingHtml(dir, name) {
  try {
    await fs.access(path.join(dir, name.replace(/\.txt$/, '.html')))
    return true
  } catch {
    return false
  }
}

await walk(OUT)
process.stdout.write(
  `pruned ${removedFiles} prefetch payloads and ${removedDirs} empty directories (${(bytes / 1048576).toFixed(1)} MB)\n`,
)
