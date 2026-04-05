export function extractVideoId(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('?')[0]
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/shorts/')[1].split('?')[0]
      return parsed.searchParams.get('v')
    }
  } catch {}
  return null
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
}

function parseXml(xml) {
  const lines = []
  const re = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const text = decodeHtml(m[2])
    const sec = Math.floor(parseFloat(m[1]))
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }
  return lines
}

// ─── Transcript with audio fallback ──────────────────────────────────────────

export async function getTranscriptWithFallback(videoId) {
  // 1. Try existing captions first (fast)
  try {
    const transcript = await fetchTranscript(videoId)
    return { transcript, source: 'captions' }
  } catch (err) {
    const msg = (err?.message || '').toLowerCase()
    const isUnavailable =
      msg.includes('no transcript') ||
      msg.includes('disabled') ||
      msg.includes('empty') ||
      msg.includes('could not get')

    if (!isUnavailable) throw err // unexpected error — rethrow

    console.log('[transcript] no captions, falling back to audio transcription…')
  }

  // 2. Fall back to audio download + Whisper transcription
  const { generateTranscriptFromAudio } = await import('./audioTranscript.js')
  const transcript = await generateTranscriptFromAudio(videoId)
  return { transcript, source: 'audio' }
}

export async function fetchTranscript(videoId) {
  const { Innertube } = await import('youtubei.js')

  const yt = await Innertube.create({ generate_session_locally: true })

  const info = await yt.getInfo(videoId)

  // Get caption tracks from the player response
  const tracks = info.captions?.caption_tracks

  if (!tracks || tracks.length === 0) {
    throw new Error('No transcript available for this video.')
  }

  const track =
    tracks.find(t => t.language_code === 'en' && !t.kind) ||
    tracks.find(t => t.language_code === 'en') ||
    tracks.find(t => t.language_code?.startsWith('en')) ||
    tracks[0]

  const captionRes = await fetch(track.base_url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.youtube.com/',
    },
  })

  const xml = await captionRes.text()

  console.log('[transcript] xml preview:', xml.slice(0, 150))

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Transcript was empty.')

  return lines.join('\n')
}
