export const config = { runtime: 'edge' }

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const CONSENT_COOKIES = 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB'

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
}

function parseXml(xml) {
  const lines = []
  // ANDROID format
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
    const mm = String(Math.floor(sec / 60)).padStart(2, '0')
    const ss = String(sec % 60).padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }
  if (lines.length > 0) return lines
  // Classic format
  const re = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const text = decodeHtml(m[2])
    const sec = Math.floor(parseFloat(m[1]))
    const mm = String(Math.floor(sec / 60)).padStart(2, '0')
    const ss = String(sec % 60).padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }
  return lines
}

// ─── Strategy 1: Google Apps Script proxy (runs on Google infra) ─────────────

async function fetchViaProxy(videoId) {
  const proxyUrl = process.env.TRANSCRIPT_PROXY_URL
  if (!proxyUrl) throw new Error('TRANSCRIPT_PROXY_URL not configured')

  const url = `${proxyUrl}?v=${encodeURIComponent(videoId)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'follow' })

  // Google Apps Script redirects; follow the redirect
  const text = await res.text()
  if (!text) throw new Error('Empty response from proxy')

  let data
  try { data = JSON.parse(text) } catch { throw new Error('Invalid JSON from proxy') }

  if (data.error) throw new Error(data.error)
  if (!data.transcript || data.transcript.length < 50) throw new Error('No transcript from proxy')

  return { transcript: data.transcript, source: data.source || 'proxy', lines: data.lines || 0 }
}

// ─── Strategy 2: Direct YouTube fetch (works locally / non-blocked IPs) ──────

async function fetchDirect(videoId) {
  // Try ANDROID InnerTube
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
      videoId,
    }),
    signal: AbortSignal.timeout(10000),
  })
  const data = await res.json()
  if (data?.playabilityStatus?.status !== 'OK') throw new Error(data?.playabilityStatus?.status || 'not OK')

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('no tracks')

  const track = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || tracks.find(t => t.languageCode === 'en')
    || tracks.find(t => t.languageCode?.startsWith('en'))
    || tracks[0]

  const capRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
    signal: AbortSignal.timeout(10000),
  })
  const xml = await capRes.text()
  if (!xml || xml.length < 50) throw new Error('empty xml')

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('0 lines')
  return { transcript: lines.join('\n'), source: 'direct', lines: lines.length }
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

  // Try Google Apps Script proxy first (works from cloud)
  try {
    const result = await fetchViaProxy(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log('[transcript] proxy failed:', err.message)
  }

  // Fall back to direct fetch (works locally)
  try {
    const result = await fetchDirect(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log('[transcript] direct failed:', err.message)
  }

  return new Response(
    JSON.stringify({ error: 'No transcript available for this video.' }),
    { status: 422, headers: { 'Content-Type': 'application/json' } }
  )
}
