import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages serves a project site from /<repo>/. Set BASE_PATH=''  (or run
// any other host) to build for a root-served deployment.
const basePath = process.env.BASE_PATH ?? ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: GitHub Pages serves files, not a Node server. Every route in
  // this app is already fully prerendered, so nothing is lost -- the one
  // dynamic piece, the /r2proxy scroll-sequence proxy, is replaced by the
  // frames vendored into public/r2proxy/ (see scripts/vendor-frames.mjs).
  output: 'export',

  // Only affects Next's own asset URLs (/_next/...). Everything the Framer
  // export references stays document-relative and resolves under any base.
  basePath,

  // No Image Optimization server in an export. The site does not use
  // next/image -- Framer emits plain <img> -- but the flag is required.
  images: { unoptimized: true },

  // This project sits inside ~/Downloads, where unrelated lockfiles higher up
  // make Turbopack infer the wrong workspace root.
  turbopack: { root: here },
}

export default nextConfig
