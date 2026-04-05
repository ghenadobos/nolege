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
    try {
      const result = await getTranscriptWithFallback(videoId)
      transcript = result.transcript
      transcriptSource = result.source
    } catch (err) {
      const msg = (err?.message || '').toLowerCase()
      console.error('Transcript error:', err?.message)
      if (msg.includes('download') || msg.includes('audio') || msg.includes('ffmpeg') || msg.includes('decipher')) {
        return res.status(422).json({ error: `Could not download or transcribe audio: ${err?.message || 'unknown error'}` })
      }
      if (msg.includes('no transcript') || msg.includes('empty') || msg.includes('could not get')) {
        return res.status(422).json({ error: 'No captions available and audio transcription also failed.' })
      }
      return res.status(422).json({ error: `Failed to get transcript: ${err?.message || 'unknown error'}` })
    }

    const charLimits = { quick: 20000, standard: 50000, full: 100000 }
    const trimmed = sampleTranscript(transcript, charLimits[depth] || 50000)

    // Classify content type for study-pack (fast call on first 4k chars)
    let learningType = 'conceptual'
    if (mode === 'study-pack') {
      try {
        const classification = await classifyTranscript(trimmed)
        learningType = classification.learningType || 'conceptual'
        console.log(`[classify] ${learningType} (confidence: ${classification.confidence}) — ${classification.reason}`)
      } catch (err) {
        console.warn('Classification failed, defaulting to conceptual:', err?.message)
      }
    }

    let result
    try {
      result = await processTranscript(trimmed, mode, depth, learningType, languageName)
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
