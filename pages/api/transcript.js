export const config = { runtime: 'edge' }

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const CONSENT_COOKIES = 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB'

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
}

function pad(n) { return String(n).padStart(2, '0') }

function formatTimestamp(sec) {
  return `[${pad(Math.floor(sec / 60))}:${pad(sec % 60)}]`
}

function parseXml(xml) {
  const lines = []
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
    if (text) lines.push(`${formatTimestamp(Math.floor(startMs / 1000))} ${text}`)
  }
  if (lines.length > 0) return lines
  const re = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const text = decodeHtml(m[2])
    if (text) lines.push(`${formatTimestamp(Math.floor(parseFloat(m[1])))} ${text}`)
  }
  return lines
}

// ─── Strategy 1: Supadata API (reliable from cloud, free tier 100 req/month) ─

async function fetchViaSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY
  if (!apiKey) throw new Error('SUPADATA_API_KEY not configured')

  const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=false`
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(20000),
  })

  if (res.status === 202) {
    const job = await res.json()
    const jobId = job.id || job.jobId
    if (!jobId) throw new Error('got 202 but no job ID')
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const poll = await fetch(`https://api.supadata.ai/v1/transcript/${jobId}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(10000),
      })
      if (poll.status === 200) {
        const data = await poll.json()
        if (data.content) return formatSupadataResponse(data)
      }
    }
    throw new Error('job not ready after polling')
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`)
  }

  const data = await res.json()
  return formatSupadataResponse(data)
}

function formatSupadataResponse(data) {
  if (!data.content) throw new Error('no content in response')

  if (typeof data.content === 'string') {
    if (data.content.length < 50) throw new Error('content too short')
    return { transcript: data.content, source: 'supadata', lines: data.content.split('\n').length }
  }

  if (!Array.isArray(data.content) || data.content.length === 0) throw new Error('empty segments')

  const lines = data.content
    .filter(seg => seg.text && seg.text.trim())
    .map(seg => {
      const sec = Math.floor((seg.offset || 0) / 1000)
      return `${formatTimestamp(sec)} ${seg.text.trim()}`
    })

  if (lines.length === 0) throw new Error('0 lines after parsing')
  return { transcript: lines.join('\n'), source: 'supadata', lines: lines.length }
}

// ─── Strategy 2: Google Apps Script proxy ───────────────────────────────────

async function fetchViaProxy(videoId) {
  const proxyUrl = process.env.TRANSCRIPT_PROXY_URL
  if (!proxyUrl) throw new Error('TRANSCRIPT_PROXY_URL not configured')

  const url = `${proxyUrl}?v=${encodeURIComponent(videoId)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'follow' })
  const text = await res.text()
  if (!text) throw new Error('Empty response from proxy')

  let data
  try { data = JSON.parse(text) } catch { throw new Error('Invalid JSON from proxy') }
  if (data.error) throw new Error(data.error)
  if (!data.transcript || data.transcript.length < 50) throw new Error('No transcript from proxy')

  return { transcript: data.transcript, source: data.source || 'proxy', lines: data.lines || 0 }
}

// ─── Strategy 3: Direct YouTube fetch (works locally / non-blocked IPs) ─────

async function fetchDirect(videoId) {
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

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v')

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'Missing ?v= parameter' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const errors = []

  // Strategy 1: Supadata API (works reliably from cloud)
  try {
    const result = await fetchViaSupadata(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    errors.push(`supadata: ${err.message}`)
    console.log('[transcript] supadata failed:', err.message)
  }

  // Strategy 2: Google Apps Script proxy
  try {
    const result = await fetchViaProxy(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    errors.push(`proxy: ${err.message}`)
    console.log('[transcript] proxy failed:', err.message)
  }

  // Strategy 3: Direct YouTube fetch (works locally)
  try {
    const result = await fetchDirect(videoId)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    errors.push(`direct: ${err.message}`)
    console.log('[transcript] direct failed:', err.message)
  }

  return new Response(
    JSON.stringify({ error: 'No transcript available for this video.', details: errors.join(' | ') }),
    { status: 422, headers: { 'Content-Type': 'application/json' } }
  )
}
