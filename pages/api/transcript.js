// Edge Runtime — runs on Cloudflare (different IPs from AWS Lambda serverless)
export const config = { runtime: 'edge' }

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
}

function parseClassicXml(xml) {
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

function parseAndroidXml(xml) {
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
    const sec = Math.floor(startMs / 1000)
    const mm = Math.floor(sec / 60).toString().padStart(2, '0')
    const ss = (sec % 60).toString().padStart(2, '0')
    if (text) lines.push(`[${mm}:${ss}] ${text}`)
  }
  return lines
}

function parseXml(xml) {
  const androidLines = parseAndroidXml(xml)
  if (androidLines.length > 0) return androidLines
  return parseClassicXml(xml)
}

function pickTrack(tracks) {
  return (
    tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]
  )
}

async function fetchCaptions(tracks) {
  const track = pickTrack(tracks)
  const capRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA },
  })
  if (!capRes.ok) throw new Error(`Caption fetch HTTP ${capRes.status}`)
  const xml = await capRes.text()
  if (!xml || xml.length < 50) throw new Error('Caption XML empty')
  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Parsed transcript empty')
  return lines.join('\n')
}

async function fetchViaAndroid(videoId) {
  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId,
      }),
    }
  )
  if (!res.ok) throw new Error(`ANDROID player HTTP ${res.status}`)
  const data = await res.json()
  const status = data?.playabilityStatus?.status
  if (status && status !== 'OK') throw new Error(`Video: ${status}`)
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('No caption tracks')
  return fetchCaptions(tracks)
}

async function fetchViaPageScrape(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': WEB_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=PENDING+999',
    },
  })
  if (!res.ok) throw new Error(`Page HTTP ${res.status}`)
  const html = await res.text()
  if (html.includes('class="g-recaptcha"')) throw new Error('CAPTCHA')
  const match = html.match(/"captionTracks":(\[.*?\])/)
  if (!match) throw new Error('No captionTracks in HTML')
  const tracks = JSON.parse(match[1])
  if (!tracks?.length) throw new Error('Empty captionTracks')
  return fetchCaptions(tracks)
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v')

  if (!videoId) {
    return new Response(JSON.stringify({ error: 'Missing ?v= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const errors = []

  // Strategy 1: ANDROID InnerTube
  try {
    const transcript = await fetchViaAndroid(videoId)
    return new Response(JSON.stringify({ transcript, source: 'android' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    errors.push(`android: ${err.message}`)
  }

  // Strategy 2: Page scrape
  try {
    const transcript = await fetchViaPageScrape(videoId)
    return new Response(JSON.stringify({ transcript, source: 'scrape' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    errors.push(`scrape: ${err.message}`)
  }

  return new Response(
    JSON.stringify({ error: `No transcript available. ${errors.join(' | ')}` }),
    { status: 422, headers: { 'Content-Type': 'application/json' } }
  )
}
