/**
 * Quick query: Check Ohio Wave (wave 17) signups in Firestore launch-allowlist.
 * Usage: node scripts/check-ohio-wave.mjs
 */

import { readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const PROJECT_ID = "doing-life-today"
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

async function getAccessToken() {
  const configPath = join(homedir(), ".config", "configstore", "firebase-tools.json")
  const config = JSON.parse(readFileSync(configPath, "utf-8"))
  const refreshToken = config?.tokens?.refresh_token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    }),
  })
  const data = await resp.json()
  return data.access_token
}

async function main() {
  const token = await getAccessToken()

  // Query launch-allowlist for wave 17
  const resp = await fetch(`${BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "launch-allowlist" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "wave" },
            op: "EQUAL",
            value: { integerValue: "17" },
          },
        },
      },
    }),
  })

  const results = await resp.json()

  if (!Array.isArray(results) || !results[0]?.document) {
    // Try string value "17" in case it's stored as string
    const resp2 = await fetch(`${BASE}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "launch-allowlist" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "wave" },
              op: "EQUAL",
              value: { stringValue: "17" },
            },
          },
        },
      }),
    })
    const results2 = await resp2.json()

    if (!Array.isArray(results2) || !results2[0]?.document) {
      // Also try source = ohio_wave
      const resp3 = await fetch(`${BASE}:runQuery`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "launch-allowlist" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "source" },
                op: "EQUAL",
                value: { stringValue: "ohio_wave" },
              },
            },
          },
        }),
      })
      const results3 = await resp3.json()

      if (!Array.isArray(results3) || !results3[0]?.document) {
        console.log("No Ohio Wave (wave 17) signups found yet.")
        
        // Show total allowlist count for context
        const allResp = await fetch(`${BASE}:runQuery`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: "launch-allowlist" }],
              select: { fields: [{ fieldPath: "wave" }, { fieldPath: "source" }] },
            },
          }),
        })
        const allResults = await allResp.json()
        const docs = Array.isArray(allResults) ? allResults.filter(r => r.document) : []
        
        // Group by wave
        const waves = {}
        for (const r of docs) {
          const w = r.document.fields?.wave?.integerValue || r.document.fields?.wave?.stringValue || "unknown"
          waves[w] = (waves[w] || 0) + 1
        }
        console.log(`\nTotal allowlist entries: ${docs.length}`)
        console.log("By wave:", waves)
        return
      }
      printResults(results3, "source=ohio_wave")
      return
    }
    printResults(results2, "wave='17'")
    return
  }
  printResults(results, "wave=17")
}

function printResults(results, label) {
  const docs = results.filter(r => r.document)
  console.log(`\n=== Ohio Wave Signups (${label}) === ${docs.length} total\n`)
  for (const r of docs) {
    const f = r.document.fields
    const email = f?.email?.stringValue || r.document.name.split("/").pop()
    const source = f?.source?.stringValue || ""
    const role = f?.audienceRole?.stringValue || f?.role?.stringValue || ""
    const ts = f?.timestamp?.timestampValue || f?.createdAt?.timestampValue || ""
    console.log(`  ${email} | ${role} | ${source} | ${ts}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
