#!/usr/bin/env node
/**
 * Inject the "Care Partners ▾" dropdown into every dolifetoday HTML page's
 * canonical desktop nav, and add Clinical Trial Match + Carmen's Care
 * Partner Corner links to the mobile-nav. Idempotent — skips files that
 * already contain the dropdown.
 *
 * Run from the dolifetoday project root:
 *   node scripts/add-care-partners-dropdown.mjs
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const PUBLIC_DIR = 'public'
const MARKER = 'nav-dropdown-toggle'           // skip files that already have the dropdown
const DESKTOP_ANCHOR = '<li><a href="/theclub">The Club</a></li>'
const MOBILE_ANCHOR = '<a href="/theclub">The Club</a>'

const DESKTOP_INSERT = `
        <li class="nav-dropdown">
          <button type="button" class="nav-dropdown-toggle" aria-haspopup="true" aria-expanded="false">Care Partners</button>
          <ul class="nav-dropdown-menu" role="menu">
            <li role="none"><a href="/carmens-care-partner-corner" role="menuitem">Carmen's Care Partner Corner<small>Dashboard, Circle, daily check-ins</small></a></li>
            <li role="none"><a href="/care-partners" role="menuitem">Care Partners Guide<small>Supporting someone with Parkinson's</small></a></li>
            <li role="none"><a href="/caregiver-burnout" role="menuitem">Caregiver Burnout<small>Spot it and recover</small></a></li>
          </ul>
        </li>`

const MOBILE_INSERT = `
    <a href="/carmens-care-partner-corner">Carmen's Care Partner Corner</a>
    <a href="/clinical-trial-match">Clinical Trial Match</a>`

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip provider prerender output and exchange pages — separate template.
      if (entry.name === 'exchange' || entry.name === 'admin' || entry.name === 'press') continue
      yield* walk(p)
    } else if (entry.isFile() && p.endsWith('.html')) {
      yield p
    }
  }
}

let scanned = 0
let updated = 0
let skipped = 0

for await (const file of walk(PUBLIC_DIR)) {
  scanned++
  let html
  try { html = await readFile(file, 'utf8') } catch { continue }

  if (html.includes(MARKER)) { skipped++; continue }

  let nextHtml = html
  let changed = false

  // Desktop nav — inject dropdown right after the existing "The Club" item.
  if (nextHtml.includes(DESKTOP_ANCHOR)) {
    nextHtml = nextHtml.replace(DESKTOP_ANCHOR, DESKTOP_ANCHOR + DESKTOP_INSERT)
    changed = true
  }

  // Mobile nav — append Care Partner Corner + Clinical Trial Match after the
  // mobile "The Club" link. Use a regex that requires we're inside the
  // mobile-nav (the desktop anchor was already mutated above, so plain
  // string replace would re-target the wrong spot).
  const mobileRegex = /(<a href="\/theclub">The Club<\/a>)(\s*<a href="\/exchange")/m
  if (mobileRegex.test(nextHtml)) {
    nextHtml = nextHtml.replace(
      mobileRegex,
      `$1${MOBILE_INSERT}$2`,
    )
    changed = true
  }

  if (changed) {
    await writeFile(file, nextHtml, 'utf8')
    updated++
    console.log('  +', file)
  }
}

console.log(`\nScanned: ${scanned}  Updated: ${updated}  Skipped (already done): ${skipped}`)
