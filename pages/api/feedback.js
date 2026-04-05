import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const entry = {
    timestamp: new Date().toISOString(),
    ...req.body,
  }

  // Always log to server console (visible in terminal / production logs)
  console.log('[FEEDBACK]', JSON.stringify(entry))

  // In development, also persist to data/feedback.jsonl for easy review
  if (process.env.NODE_ENV === 'development') {
    try {
      const dir = join(process.cwd(), 'data')
      await mkdir(dir, { recursive: true })
      await appendFile(join(dir, 'feedback.jsonl'), JSON.stringify(entry) + '\n', 'utf8')
    } catch (err) {
      console.warn('[FEEDBACK] file write failed:', err.message)
    }
  }

  return res.status(200).json({ ok: true })
}
