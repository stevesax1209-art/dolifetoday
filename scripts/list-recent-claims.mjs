// Read-only: list recent Exchange provider claims to see what admin missed.
import admin from 'firebase-admin'
import { readFileSync } from 'node:fs'

const svc = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(svc) })

const db = admin.firestore()

async function main() {
  const collections = [
    { name: 'providers', label: 'providers (PENDING/APPROVED with externalProviderId)' },
    { name: 'listingClaims', label: 'listingClaims (in-app KV)' },
  ]

  for (const c of collections) {
    console.log(`\n── ${c.label} ──`)
    try {
      const snap = await db.collection(c.name)
        .where('status', 'in', ['PENDING', 'APPROVED', 'pending', 'approved'])
        .limit(30).get()
      if (snap.empty) { console.log('  (none)'); continue }
      snap.forEach(d => {
        const x = d.data()
        const when = x.createdAt?.toDate?.() || (x.submittedAt ? new Date(x.submittedAt) : null)
        console.log(`  ${d.id.slice(0,10)}… ${x.name || x.providerName || x.listingName || '(no name)'} status=${x.status} by=${x.claimedBy || x.userId || x.claimEmail || '?'} ${when ? when.toISOString().slice(0,10) : ''}`)
      })
    } catch (e) {
      console.log(`  ERROR: ${e.message}`)
    }
  }
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
