// Edge Runtime for transcript fetching
export const config = { runtime: 'edge' }

// ─── Consent cookies — required for YouTube access from cloud servers ────────
const CONSENT_COOKIES = [
  'CONSENT=YES+cb.20210328-17-p0.en+FX+999',
  'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB',
].join('; ')

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ─── XML parsing ─────────────────────────────────────────────────────────────

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
}

function parseXml(xml) {
  const lines = []

  // ANDROID format: <p t="ms" d="ms"><s>text</s></p>
  const pRe = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let pm
  while ((pm = pRe.exec(xml)) !== null) {
    const startMs = parseInt(pm[1], 10)
    const inner = pm[3]
    let text = ''
    const sRe = /<s[^>]*>([^<]*)<\/s>/g
    let sm
    while ((sm = sRe.exec(inner)) !== null) text += sm[1]
    if (!text) text = inner.replace(/<[^>]+>/g, '')
    text = decodeHtml(text).trim()
    const sec = Math.floor(startMs / 1000)
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }
  if (lines.length > 0) return lines

  // Classic format: <text start="sec" dur="sec">text</text>
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

function pickTrack(tracks) {
  return (
    tracks.find(t => (t.languageCode || t.language_code) === 'en' && t.kind !== 'asr') ||
    tracks.find(t => (t.languageCode || t.language_code) === 'en') ||
    tracks.find(t => (t.languageCode || t.language_code)?.startsWith('en')) ||
    tracks[0]
  )
}

// ─── Strategy 1: ANDROID InnerTube with consent cookies ──────────────────────

async function fetchViaAndroid(videoId) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_UA,
      'Cookie': CONSENT_COOKIES,
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data?.playabilityStatus?.status !== 'OK') {
    throw new Error(data?.playabilityStatus?.status || 'not OK')
  }

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('no tracks')

  const track = pickTrack(tracks)
  const capRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
    signal: AbortSignal.timeout(10000),
  })
  const xml = await capRes.text()
  if (!xml || xml.length < 50) throw new Error('empty xml')

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('0 lines')
  return { transcript: lines.join('\n'), source: 'android', lines: lines.length }
}

// ─── Strategy 2: Page scrape with consent cookies ────────────────────────────

async function fetchViaPageScrape(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': WEB_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': CONSENT_COOKIES,
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  if (html.includes('class="g-recaptcha"')) throw new Error('CAPTCHA')

  const match = html.match(/"captionTracks":(\[.*?\])/)
  if (!match) throw new Error('no captionTracks in HTML')

  const tracks = JSON.parse(match[1])
  if (!tracks?.length) throw new Error('empty tracks')

  const track = pickTrack(tracks)
  const capRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
    signal: AbortSignal.timeout(10000),
  })
  const xml = await capRes.text()
  if (!xml || xml.length < 50) throw new Error('empty xml')

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('0 lines')
  return { transcript: lines.join('\n'), source: 'scrape', lines: lines.length }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v')

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'Missing ?v= parameter' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Try ANDROID InnerTube first
  try {
    const result = await fetchViaAndroid(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log('[transcript] android failed:', err.message)
  }

  // Fall back to page scrape
  try {
    const result = await fetchViaPageScrape(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log('[transcript] scrape failed:', err.message)
  }

  return new Response(
    JSON.stringify({ error: 'No transcript available for this video.' }),
    { status: 422, headers: { 'Content-Type': 'application/json' } }
  )
}
