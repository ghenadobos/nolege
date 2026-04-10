import { extractVideoId, getTranscriptWithFallback } from '../../utils/transcript'
import { processTranscript, classifyTranscript, MODES } from '../../utils/openai'
import { enhancePackWithVisuals } from '../../utils/visualAnalysis'

export const config = {
  maxDuration: 300,  // 5 min — multi-step pipeline needs time for long videos
}

const VALID_MODES = MODES.map((m) => m.id)

// For non-study-pack modes, we still sample to avoid exceeding token limits.
// Study-pack mode handles its own chunking internally.
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

    // For study-pack mode, pass the FULL transcript — the pipeline chunks it internally.
    // For other modes, sample to fit within single-prompt token limits.
    const processedTranscript = mode === 'study-pack'
      ? transcript
      : sampleTranscript(transcript, 50000)

    console.log(`[summarize] mode=${mode} depth=${depth} lang=${language} transcript=${transcript.length} chars, source=${transcriptSource}`)

    // Skip classification to save 1 API call — default to conceptual
    // (saves ~3s of the 60s Vercel timeout budget)
    const learningType = 'conceptual'

    let result
    try {
      result = await processTranscript(processedTranscript, mode, depth, learningType, languageName)
    } catch (err) {
      console.error('OpenAI error:', err?.message)
      return res.status(500).json({ error: `AI processing failed: ${err?.message || 'unknown error'}` })
    }

    // Visual enhancement — only for study-pack, non-fatal if it fails
    if (mode === 'study-pack' && result.sections?.length) {
      try {
        const visualResult = await enhancePackWithVisuals(videoId, result.sections)
        result = { ...result, ...visualResult }
        if (visualResult.visuallyEnhanced) {
          console.log('[visual] pack enhanced with visual analysis')
        }
      } catch (err) {
        console.warn('[visual] enhancement skipped:', err?.message)
      }
    }

    return res.status(200).json({ mode, learningType, transcriptSource, contentLanguage: language, ...result })
  } catch (err) {
    console.error('Unhandled error:', err)
    return res.status(500).json({ error: `Server error: ${err?.message || 'unknown error'}` })
  }
}
