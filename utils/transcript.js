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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240530.02.00',
    hl: 'en',
    gl: 'US',
  },
}

// ─── Strategy 1: InnerTube get_transcript endpoint ───────────────────────────
// Returns transcript directly as JSON — no page scraping needed.

function encodeTranscriptParams(videoId) {
  const enc = new TextEncoder()
  const videoIdBytes = enc.encode(videoId)
  const inner = new Uint8Array([0x0A, videoIdBytes.length, ...videoIdBytes])
  const outer = new Uint8Array([0x0A, inner.length, ...inner])
  return Buffer.from(outer).toString('base64')
}

async function fetchViaGetTranscript(videoId) {
  const params = encodeTranscriptParams(videoId)

  const res = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, params }),
  })

  if (!res.ok) throw new Error(`get_transcript HTTP ${res.status}`)

  const data = await res.json()
  console.log('[transcript] get_transcript response keys:', Object.keys(data))

  // Navigate the response to find transcript cues
  const actions = data?.actions || []
  const panel = actions.find(a => a.updateEngagementPanelAction)
  const body = panel
    ?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.body
    ?.transcriptBodyRenderer
  const cueGroups = body?.cueGroups || []

  if (cueGroups.length === 0) throw new Error('get_transcript returned no cues')

  const lines = []
  for (const group of cueGroups) {
    const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer
    if (!cue) continue
    const text = (cue.cue?.simpleText || '').trim()
    const startMs = parseInt(cue.startOffsetMs || '0', 10)
    const sec = Math.floor(startMs / 1000)
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }

  if (lines.length === 0) throw new Error('get_transcript returned empty transcript')
  console.log(`[transcript] get_transcript: ${lines.length} lines`)
  return lines.join('\n')
}

// ─── Strategy 2: Page scrape with consent cookie ─────────────────────────────

async function fetchViaPageScrape(videoId) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=PENDING+999',
    },
  })
  if (!pageRes.ok) throw new Error(`Page fetch HTTP ${pageRes.status}`)

  const html = await pageRes.text()
  console.log('[transcript] page length:', html.length, 'has ytInitialPlayerResponse:', html.includes('ytInitialPlayerResponse'))

  // Extract captionTracks from ytInitialPlayerResponse
  const match = html.match(/"captionTracks":(\[.*?\])/)
  if (!match) throw new Error('captionTracks not found in page HTML')

  let tracks
  try {
    tracks = JSON.parse(match[1])
  } catch {
    throw new Error('Failed to parse captionTracks JSON')
  }
  if (!tracks?.length) throw new Error('captionTracks array is empty')

  const track =
    tracks.find(t => t.languageCode === 'en' && !t.kind) ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]

  const captionRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/' },
  })
  const xml = await captionRes.text()

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('XML parsing returned no lines')
  console.log(`[transcript] page scrape: ${lines.length} lines`)
  return lines.join('\n')
}

// ─── Strategy 3: InnerTube player API with public key ────────────────────────

async function fetchViaInnerTubePlayer(videoId) {
  const playerRes = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({ videoId, context: INNERTUBE_CONTEXT }),
    }
  )
  if (!playerRes.ok) throw new Error(`Player API HTTP ${playerRes.status}`)

  const playerData = await playerRes.json()
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks

  if (!tracks?.length) throw new Error('Player API returned no caption tracks')

  const track =
    tracks.find(t => t.languageCode === 'en' && !t.kind) ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]

  const captionRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/' },
  })
  const xml = await captionRes.text()

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('XML parsing returned no lines')
  console.log(`[transcript] InnerTube player: ${lines.length} lines`)
  return lines.join('\n')
}

// ─── Strategy 4: timedtext list API ──────────────────────────────────────────

async function fetchViaTimedtext(videoId) {
  const listRes = await fetch(
    `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }
  )
  const listXml = await listRes.text()

  const trackRe = /<track\b([^>]+)>/g
  const found = []
  let tm
  while ((tm = trackRe.exec(listXml)) !== null) {
    const attrs = tm[1]
    const langCode = attrs.match(/lang_code="([^"]+)"/)?.[1]
    const name = attrs.match(/\bname="([^"]*)"/)?.[1] ?? ''
    if (langCode) found.push({ langCode, name })
  }

  if (!found.length) throw new Error('Timedtext list returned no tracks')

  const track =
    found.find(t => t.langCode === 'en' && t.name === '') ||
    found.find(t => t.langCode === 'en') ||
    found.find(t => t.langCode?.startsWith('en')) ||
    found[0]

  const params = new URLSearchParams({ v: videoId, lang: track.langCode })
  if (track.name) params.set('name', track.name)

  const captionRes = await fetch(
    `https://www.youtube.com/api/timedtext?${params}`,
    { headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/' } }
  )
  const xml = await captionRes.text()

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Timedtext XML returned no lines')
  console.log(`[transcript] timedtext: ${lines.length} lines`)
  return lines.join('\n')
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function getTranscriptWithFallback(videoId) {
  const transcript = await fetchTranscript(videoId)
  return { transcript, source: 'captions' }
}

export async function fetchTranscript(videoId) {
  const strategies = [
    { name: 'get_transcript', fn: () => fetchViaGetTranscript(videoId) },
    { name: 'page_scrape',    fn: () => fetchViaPageScrape(videoId) },
    { name: 'innertube',      fn: () => fetchViaInnerTubePlayer(videoId) },
    { name: 'timedtext',      fn: () => fetchViaTimedtext(videoId) },
  ]

  const errors = []
  for (const { name, fn } of strategies) {
    try {
      const result = await fn()
      console.log(`[transcript] ✓ success via ${name}`)
      return result
    } catch (err) {
      console.log(`[transcript] ✗ ${name} failed: ${err.message}`)
      errors.push(`${name}: ${err.message}`)
    }
  }

  throw new Error(`No transcript available for this video. [${errors.join(' | ')}]`)
}
