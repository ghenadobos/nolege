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

// ─── Strategy 1: YouTube timedtext API ───────────────────────────────────────

async function fetchViaTimedtext(videoId, UA) {
  // List available caption tracks
  const listRes = await fetch(
    `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }
  )
  const listXml = await listRes.text()

  // Parse track list: <track id="0" name="" lang_code="en" .../>
  const trackRe = /<track\b([^>]+)>/g
  const found = []
  let tm
  while ((tm = trackRe.exec(listXml)) !== null) {
    const attrs = tm[1]
    const langCode = attrs.match(/lang_code="([^"]+)"/)?.[1]
    const name = attrs.match(/\bname="([^"]*)"/)?.[1] ?? ''
    const kind = attrs.match(/\bkind="([^"]*)"/)?.[1] ?? ''
    if (langCode) found.push({ langCode, name, kind })
  }

  if (!found.length) throw new Error('No transcript available for this video.')

  const track =
    found.find(t => t.langCode === 'en' && t.kind !== 'asr' && t.name === '') ||
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

  console.log('[transcript] timedtext xml preview:', xml.slice(0, 150))

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Transcript was empty.')
  return lines.join('\n')
}

// ─── Strategy 2: InnerTube player API ────────────────────────────────────────

async function fetchViaInnerTube(videoId, UA) {
  const playerRes = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
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
    }
  )

  if (!playerRes.ok) throw new Error(`InnerTube request failed: ${playerRes.status}`)

  const playerData = await playerRes.json()
  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks

  if (!tracks?.length) throw new Error('No transcript available for this video.')

  const track =
    tracks.find(t => t.languageCode === 'en' && !t.kind) ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]

  const captionRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.youtube.com/' },
  })
  const xml = await captionRes.text()

  console.log('[transcript] innertube xml preview:', xml.slice(0, 150))

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Transcript was empty.')
  return lines.join('\n')
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function getTranscriptWithFallback(videoId) {
  const transcript = await fetchTranscript(videoId)
  return { transcript, source: 'captions' }
}

export async function fetchTranscript(videoId) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

  // Try timedtext API first (simpler, no auth)
  try {
    return await fetchViaTimedtext(videoId, UA)
  } catch (err) {
    console.log('[transcript] timedtext failed:', err.message, '— trying InnerTube…')
  }

  // Fall back to InnerTube player API
  return await fetchViaInnerTube(videoId, UA)
}
