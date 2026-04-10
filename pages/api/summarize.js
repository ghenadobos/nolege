import { extractVideoId, getTranscriptWithFallback } from '../../utils/transcript'
import { processTranscript, classifyTranscript, MODES } from '../../utils/openai'
import { enhancePackWithVisuals } from '../../utils/visualAnalysis'

const VALID_MODES = MODES.map((m) => m.id)

function sampleTranscript(transcript, maxChars) {
  if (transcript.length <= maxChars) return transcript
  const lines = transcript.split('\n')
  const ratio = maxChars / transcript.length
  const targetLines = Math.floor(lines.length * ratio)
  const step = lines.length / targetLines
  const sampled = []
  for (let i = 0; i < targetLines; i++) {
    sampled.push(lines[Math.floor(i * step)])
  }
  return sampled.join('\n') + '\n[transcript sampled from full video]'
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { url, mode = 'action-steps', depth = 'standard', language = 'en' } = req.body
    const languageName = language === 'cs' ? 'Czech' : 'English'

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'YouTube URL is required.' })
    }

    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode.' })
    }

    const videoId = extractVideoId(url.trim())
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL. Please paste a valid link.' })
    }

    let transcript
    let transcriptSource = 'captions'

    // Accept pre-fetched transcript from client (Edge Runtime path)
    if (req.body.transcript && typeof req.body.transcript === 'string' && req.body.transcript.length > 50) {
      transcript = req.body.transcript
      transcriptSource = req.body.transcriptSource || 'edge'
    } else {
      // Fallback: try server-side fetch (works locally, may fail on Vercel)
      try {
        const result = await getTranscriptWithFallback(videoId)
        transcript = result.transcript
        transcriptSource = result.source
      } catch (err) {
        const msg = (err?.message || '').toLowerCase()
        console.error('Transcript error:', err?.message)
        if (msg.includes('no transcript') || msg.includes('empty') || msg.includes('could not get')) {
          return res.status(422).json({ error: 'No captions available for this video.' })
        }
        return res.status(422).json({ error: `Failed to get transcript: ${err?.message || 'unknown error'}` })
      }
    }

    const charLimits = { quick: 20000, standard: 50000, full: 100000 }
    const trimmed = sampleTranscript(transcript, charLimits[depth] || 50000)

    // Skip classification — saves 1 API call for the 60s budget
    const learningType = 'conceptual'

    console.log(`[summarize] calling processTranscript: mode=${mode} depth=${depth} chars=${trimmed.length}`)
    let result
    try {
      result = await processTranscript(trimmed, mode, depth, learningType, languageName)
      console.log(`[summarize] processTranscript returned OK`)
    } catch (err) {
      console.error('OpenAI error:', err?.message, err?.status, err?.code)
      return res.status(500).json({ error: `AI processing failed: ${err?.message || 'unknown error'}` })
    }

    // Visual enhancement disabled — saves time for 60s budget
    // if (mode === 'study-pack' && result.sections?.length) { ... }

    return res.status(200).json({ mode, learningType, transcriptSource, contentLanguage: language, ...result })
  } catch (err) {
    console.error('Unhandled error:', err)
    return res.status(500).json({ error: `Server error: ${err?.message || 'unknown error'}` })
  }
}
