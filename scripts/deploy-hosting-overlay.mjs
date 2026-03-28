#!/usr/bin/env node

import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

function printUsage() {
  console.log([
    'Usage: node scripts/deploy-hosting-overlay.mjs [options] <file> [file...]',
    '',
    'Options:',
    '  --site <url>         Public site base URL. Default: https://dolifetoday.com',
    '  --temp-dir <path>    Use a specific temp directory instead of a generated one.',
    '  --deploy             Run firebase deploy --only hosting after preparing the temp dir.',
    '  --keep-temp          Keep the prepared temp directory after completion.',
    '  --help               Show this message.',
    '',
    'Example:',
    '  node scripts/deploy-hosting-overlay.mjs --deploy public/exchange.html public/js/exchange.js',
  ].join('\n'))
}

function normalizeSiteUrl(value) {
  return String(value || 'https://dolifetoday.com').replace(/\/+$/, '')
}

function normalizeRelativeFile(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized.startsWith('public/')) {
    throw new Error(`Only files inside public/ can be deployed with this script: ${value}`)
  }
  return normalized
}

function parseArgs(argv) {
  const options = {
    site: 'https://dolifetoday.com',
    deploy: false,
    keepTemp: false,
    tempDir: '',
    files: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--help' || token === '-h') {
      printUsage()
      process.exit(0)
    }

    if (token === '--site') {
      index += 1
      if (index >= argv.length) throw new Error('--site requires a value')
      options.site = argv[index]
      continue
    }

    if (token === '--temp-dir') {
      index += 1
      if (index >= argv.length) throw new Error('--temp-dir requires a value')
      options.tempDir = argv[index]
      continue
    }

    if (token === '--deploy') {
      options.deploy = true
      continue
    }

    if (token === '--keep-temp') {
      options.keepTemp = true
      continue
    }

    if (token.startsWith('--')) {
      throw new Error(`Unknown option: ${token}`)
    }

    options.files.push(normalizeRelativeFile(token))
  }

  if (!options.files.length) {
    throw new Error('At least one public/ file must be provided')
  }

  options.site = normalizeSiteUrl(options.site)
  options.files = Array.from(new Set(options.files)).sort()
  return options
}

async function readHostingConfig() {
  const firebaseJsonPath = path.join(repoRoot, 'firebase.json')
  const raw = await readFile(firebaseJsonPath, 'utf8')
  const config = JSON.parse(raw)
  const hosting = config.hosting || {}

  if (!hosting.public) {
    throw new Error('firebase.json hosting.public is not configured')
  }

  return {
    publicDir: hosting.public,
    cleanUrls: Boolean(hosting.cleanUrls),
  }
}

async function walkPublicFiles(rootDir) {
  const results = []

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue
      if (entry.name.startsWith('.')) continue
      if (entry.name === 'node_modules') continue

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/')
      results.push(relativePath)
    }
  }

  await walk(rootDir)
  return results.sort()
}

function buildLiveUrl(site, publicRelativePath, cleanUrls) {
  const encodeRoute = (route) => route.split('/').map((segment) => encodeURIComponent(segment)).join('/')

  if (publicRelativePath === 'index.html') {
    return `${site}/`
  }

  if (publicRelativePath.endsWith('/index.html')) {
    const route = publicRelativePath.slice(0, -'/index.html'.length)
    return `${site}/${encodeRoute(route)}`
  }

  if (cleanUrls && publicRelativePath.endsWith('.html')) {
    return `${site}/${encodeRoute(publicRelativePath.slice(0, -'.html'.length))}`
  }

  return `${site}/${encodeRoute(publicRelativePath)}`
}

async function fetchLiveFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      Accept: '*/*',
      'Cache-Control': 'no-cache',
    },
  })

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new Error(`Unable to fetch live file ${url} (${response.status})`)
  }

  const arrayBuffer = await response.arrayBuffer()
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, Buffer.from(arrayBuffer))
  return true
}

async function ensureLocalFilesExist(files) {
  for (const relativeFile of files) {
    const fullPath = path.join(repoRoot, relativeFile)
    const fileStat = await stat(fullPath).catch(() => null)
    if (!fileStat || !fileStat.isFile()) {
      throw new Error(`Local file not found: ${relativeFile}`)
    }
  }
}

async function prepareTempDir(preferredTempDir) {
  if (preferredTempDir) {
    const resolved = path.resolve(repoRoot, preferredTempDir)
    await rm(resolved, { recursive: true, force: true })
    await mkdir(resolved, { recursive: true })
    return resolved
  }

  return mkdtemp(path.join(os.tmpdir(), 'dlt-hosting-overlay-'))
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const hosting = await readHostingConfig()
  const publicRoot = path.join(repoRoot, hosting.publicDir)
  const publicFiles = await walkPublicFiles(publicRoot)

  await ensureLocalFilesExist(options.files)

  const tempDir = await prepareTempDir(options.tempDir)
  const tempPublicDir = path.join(tempDir, hosting.publicDir)

  console.log(`Preparing hosting overlay in ${tempDir}`)
  console.log(`Using live site baseline: ${options.site}`)
  console.log(`Overlay files (${options.files.length}):`)
  options.files.forEach((file) => console.log(`  - ${file}`))

  let fetchedCount = 0
  let skippedMissingCount = 0

  for (const relativePublicFile of publicFiles) {
    const liveUrl = buildLiveUrl(options.site, relativePublicFile, hosting.cleanUrls)
    const outputPath = path.join(tempPublicDir, relativePublicFile)
    const fetched = await fetchLiveFile(liveUrl, outputPath)
    if (fetched) {
      fetchedCount += 1
    } else {
      skippedMissingCount += 1
      console.warn(`Skipping live-missing file: ${relativePublicFile}`)
    }
  }

  console.log(`Fetched ${fetchedCount} live baseline files; skipped ${skippedMissingCount} production 404s.`)

  for (const relativeFile of options.files) {
    const sourcePath = path.join(repoRoot, relativeFile)
    const destinationPath = path.join(tempDir, relativeFile)
    await mkdir(path.dirname(destinationPath), { recursive: true })
    await copyFile(sourcePath, destinationPath)
  }

  await copyFile(path.join(repoRoot, 'firebase.json'), path.join(tempDir, 'firebase.json'))
  const firebasercPath = path.join(repoRoot, '.firebaserc')
  try {
    await copyFile(firebasercPath, path.join(tempDir, '.firebaserc'))
  } catch (_error) {
    // .firebaserc is optional in some environments.
  }

  console.log('Prepared temp deploy directory successfully.')

  if (options.deploy) {
    await runCommand('firebase', ['deploy', '--only', 'hosting'], tempDir)
  } else {
    console.log('Dry run only. Add --deploy to publish this prepared directory.')
  }

  if (options.keepTemp || !options.deploy) {
    console.log(`Temp directory retained at ${tempDir}`)
    return
  }

  await rm(tempDir, { recursive: true, force: true })
  console.log('Removed temp deploy directory.')
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})