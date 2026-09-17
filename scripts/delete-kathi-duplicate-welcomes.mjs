import admin from 'firebase-admin'
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'pcn---new' })
const db = admin.firestore()

const KATHI_ID = '3EizqntKsbYvxz3eCkwZFEaKzvm2'

console.log('Scanning all community-posts for Paul Gasperi intro post...')
const postsSnap = await db.collection('community-posts').get()
console.log(`Loaded ${postsSnap.size} posts.`)

// Find Paul's intro post: content mentions "Paul from Georgetown" or "this is Paul"
let target = null
for (const p of postsSnap.docs) {
  const data = p.data()
  const content = (data.content || '')
  if (/Paul.{0,40}Georgetown/i.test(content) || /this is Paul.{0,40}Ontario/i.test(content)) {
    target = p
    console.log('FOUND:', p.id, '|', (data.userName || data.authorName), '|', content.slice(0, 100).replace(/\n/g,' '))
    break
  }
}
if (!target) { console.log('No matching intro post.'); process.exit(1) }

const data = target.data()
const comments = Array.isArray(data.comments) ? data.comments : []
console.log(`Total comments on this post: ${comments.length}`)

const kathis = comments.filter(c => c && c.userId === KATHI_ID)
console.log(`Kathi comments: ${kathis.length}`)
kathis.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0))
for (const c of kathis) {
  console.log('  -', c.id, '|', new Date(c.timestamp || 0).toISOString(), '|', (c.content || '').slice(0, 80).replace(/\n/g,' '))
}

if (kathis.length <= 1) { console.log('Nothing to delete.'); process.exit(0) }

// Per Kathi's email she wants the welcome message, KEEP the LAST (most polished) one
// which from the screenshot is "...wonderful first day in our community!" (latest of the 3 30-min-ago + 1 28-min-ago)
// Actually all 4 are at 28-30 min ago. The most recent is the 28min one ("your new community of friends.")
// But Kathi wrote them — let's keep the LATEST (highest timestamp) since she likely fixed it.
const keep = kathis[kathis.length - 1]
const toDelete = kathis.slice(0, -1)
const toDeleteIds = new Set(toDelete.map(c => c.id))

console.log('\nKEEPING:', keep.id, '-', (keep.content || '').slice(0, 100).replace(/\n/g,' '))
console.log('DELETING:')
for (const c of toDelete) console.log('  -', c.id, '-', (c.content || '').slice(0, 80).replace(/\n/g,' '))

const newComments = comments.filter(c => !(c && c.userId === KATHI_ID && toDeleteIds.has(c.id)))
console.log(`\nNew comments array length: ${newComments.length} (was ${comments.length})`)

await target.ref.update({ comments: newComments })
console.log('Updated post document.')

console.log('\nDone.')
process.exit(0)
