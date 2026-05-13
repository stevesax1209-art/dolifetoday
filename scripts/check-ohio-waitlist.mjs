/**
 * Quick query: Check Ohio Wave signups in the waitlist collection.
 * Usage: node scripts/check-ohio-waitlist.mjs
 */

import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const PROJECT_ID = "doing-life-today"
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

async function getAccessToken() {
  const configPath = join(homedir(), ".config", "configstore", "firebase-tools.json")
  const config = JSON.parse(readFileSync(configPath, "utf-8"))
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.tokens.refresh_token,
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    }),
  })
  return (await resp.json()).access_token
}

async function main() {
  const token = await getAccessToken()

  // Query waitlist where source = ohio_wave
  const resp = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "waitlist" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "source" },
            op: "EQUAL",
            value: { stringValue: "ohio_wave" },
          },
        },
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
      },
    }),
  })

  const results = await resp.json()
  const docs = Array.isArray(results) ? results.filter(r => r.document) : []

  if (docs.length === 0) {
    console.log("No Ohio Wave signups yet (source='ohio_wave' in waitlist collection).")
  } else {
    console.log(`=== Ohio Wave Signups: ${docs.length} ===\n`)
    for (const r of docs) {
      const f = r.document.fields
      const email = f?.email?.stringValue || "—"
      const ts = f?.createdAt?.timestampValue || "—"
      console.log(`  ${email}  |  ${ts}`)
    }
  }

  // Also show total waitlist count
  const allResp = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "waitlist" }],
        select: { fields: [{ fieldPath: "source" }] },
      },
    }),
  })
  const allResults = await allResp.json()
  const allDocs = Array.isArray(allResults) ? allResults.filter(r => r.document) : []

  const bySrc = {}
  for (const r of allDocs) {
    const src = r.document.fields?.source?.stringValue || "unknown"
    bySrc[src] = (bySrc[src] || 0) + 1
  }
  console.log(`\nTotal waitlist: ${allDocs.length}`)
  console.log("By source:", JSON.stringify(bySrc, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
