import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const entry = {
    timestamp: new Date().toISOString(),
    event:     req.body.event     || 'unknown',
    userId:    req.body.userId    || null,
    videoUrl:  req.body.videoUrl  || null,
    metadata:  req.body.metadata  || {},
  }

  console.log('[EVENT]', JSON.stringify(entry))

  try {
    const dir = join(process.cwd(), 'data')
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, 'events.jsonl'), JSON.stringify(entry) + '\n', 'utf8')
  } catch (err) {
    console.warn('[EVENT] file write failed:', err.message)
  }

  return res.status(200).json({ ok: true })
}
