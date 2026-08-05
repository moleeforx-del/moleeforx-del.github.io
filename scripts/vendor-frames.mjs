/**
 * Downloads the Framer scroll-sequence frames into public/r2proxy/.
 *
 * A Framer code component on the home page requests its frames from
 * /r2proxy/framer/1920/... and /r2proxy/framer/mob/..., which must be
 * same-origin. A static export has no route handlers, so the frames are
 * vendored as real files at exactly those paths instead. The Framer bundles
 * are not touched.
 *
 * Frames already fetched by the dev-mode proxy are reused from .r2cache
 * (keyed by sha1 of the asset path) rather than downloaded again.
 *
 * Run with: npm run vendor-frames
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CACHE_DIR = path.join(ROOT, '.r2cache')
const OUT_DIR = path.join(ROOT, 'public', 'r2proxy', 'framer')
const R2_ORIGIN = 'https://r2-assets.alethia.earth'
const CONCURRENCY = 8

/**
 * Matches the component config: digits:5, ext:'webp'.
 *
 * The sequences are ZERO-indexed: 00000..00210 for desktop, 00000..00209 for
 * mobile. Missing frame 00000 does not merely drop a frame -- the loader
 * requests it, 404s, and never completes the intro, so the scroll lock
 * (lockScrollDuringIntro) is never released and the page cannot scroll at all.
 */
const SEQUENCES = [
  { dir: '1920', prefix: 'floating-island_', lastIndex: 210 },
  { dir: 'mob', prefix: 'floating-island-mob_', lastIndex: 209 },
]

const pad = (n) => String(n).padStart(5, '0')

async function fromCache(assetPath) {
  const digest = crypto.createHash('sha1').update(assetPath).digest('hex')
  try {
    return await fs.readFile(path.join(CACHE_DIR, digest))
  } catch {
    return null
  }
}

async function download(assetPath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(R2_ORIGIN + assetPath, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
      if (res.status === 404) return null
    } catch {
      // retry
    }
  }
  throw new Error(`failed to fetch ${assetPath}`)
}

async function run() {
  const jobs = []
  for (const seq of SEQUENCES) {
    for (let i = 0; i <= seq.lastIndex; i++) {
      const name = `${seq.prefix}${pad(i)}.webp`
      jobs.push({ assetPath: `/framer/${seq.dir}/${name}`, out: path.join(OUT_DIR, seq.dir, name) })
    }
  }

  for (const seq of SEQUENCES) await fs.mkdir(path.join(OUT_DIR, seq.dir), { recursive: true })

  let cached = 0, fetched = 0, missing = 0, done = 0
  const queue = jobs.slice()

  async function worker() {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      try {
        await fs.access(job.out)
        done++
        continue // already vendored
      } catch {}

      let body = await fromCache(job.assetPath)
      if (body) cached++
      else {
        body = await download(job.assetPath)
        if (body) fetched++
        else { missing++; done++; continue }
      }
      await fs.writeFile(job.out, body)
      done++
      if (done % 50 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  process.stdout.write(`\nvendored ${jobs.length - missing} frames  (from cache: ${cached}, downloaded: ${fetched}, missing: ${missing})\n`)
  if (missing) process.exitCode = 1
}

run()
