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
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

  // Use the YouTube InnerTube API — works in serverless, returns structured JSON
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20231219.04.00',
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00',
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  })

  if (!playerRes.ok) throw new Error(`InnerTube player request failed: ${playerRes.status}`)

  const playerData = await playerRes.json()
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks

  if (!tracks?.length) throw new Error('No transcript available for this video.')

  const track =
    tracks.find(t => t.languageCode === 'en' && !t.kind) ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]

  const captionRes = await fetch(track.baseUrl, {
    headers: {
      'User-Agent': UA,
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
