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

// ─── XML parsers ─────────────────────────────────────────────────────────────

// Classic format: <text start="1.23" dur="4.56">caption text</text>
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

// ANDROID format: <p t="1230" d="4560"><s>word</s><s t="200">word2</s></p>
function parseAndroidXml(xml) {
  const lines = []
  const pRe = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let pm
  while ((pm = pRe.exec(xml)) !== null) {
    const startMs = parseInt(pm[1], 10)
    const inner = pm[3]

    // Extract text from <s> segments, or fallback to raw inner text
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
  // Try ANDROID format first (newer, returned by ANDROID client)
  const androidLines = parseAndroidXml(xml)
  if (androidLines.length > 0) return androidLines
  // Fall back to classic format
  return parseClassicXml(xml)
}

// ─── Fetch via ANDROID InnerTube client ──────────────────────────────────────
// ANDROID client returns working caption URLs (WEB client URLs are often empty).

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
  },
}

async function fetchViaAndroidInnerTube(videoId) {
  const playerRes = await fetch(
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_UA,
      },
      body: JSON.stringify({
        context: ANDROID_CONTEXT,
        videoId,
      }),
    }
  )

  if (!playerRes.ok) throw new Error(`ANDROID player HTTP ${playerRes.status}`)

  const data = await playerRes.json()

  // Check playability
  const status = data?.playabilityStatus?.status
  if (status && status !== 'OK') {
    throw new Error(`Video not playable: ${status}`)
  }

  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  if (!tracks?.length) throw new Error('No caption tracks found')

  const track =
    tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en')) ||
    tracks[0]

  console.log(`[transcript] using track: ${track.languageCode} (${track.kind || 'manual'})`)

  const capRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA },
  })
  if (!capRes.ok) throw new Error(`Caption fetch HTTP ${capRes.status}`)

  const xml = await capRes.text()
  if (!xml || xml.length < 50) throw new Error('Caption XML is empty')

  console.log(`[transcript] XML length: ${xml.length}`)

  const lines = parseXml(xml)
  if (lines.length === 0) throw new Error('Parsed transcript is empty')

  console.log(`[transcript] ✓ ${lines.length} lines via ANDROID InnerTube`)
  return lines.join('\n')
}

// ─── Fallback: page scrape with consent cookie ──────────────────────────────

const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function fetchViaPageScrape(videoId) {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': WEB_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=PENDING+999',
    },
  })
  if (!pageRes.ok) throw new Error(`Page fetch HTTP ${pageRes.status}`)

  const html = await pageRes.text()

  if (html.includes('class="g-recaptcha"')) {
    throw new Error('YouTube returned CAPTCHA')
  }

  // Parse ytInitialPlayerResponse JSON with brace counting
  const marker = 'var ytInitialPlayerResponse = '
  const startIdx = html.indexOf(marker)
  if (startIdx === -1) throw new Error('ytInitialPlayerResponse not found')

  let depth = 0
  const jsonStart = startIdx + marker.length
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') {
      depth--
      if (depth === 0) {
        try {
          const playerData = JSON.parse(html.slice(jsonStart, i + 1))
          const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
          if (!tracks?.length) throw new Error('No caption tracks in page data')

          const track =
            tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
            tracks.find(t => t.languageCode === 'en') ||
            tracks.find(t => t.languageCode?.startsWith('en')) ||
            tracks[0]

          // Fetch caption using ANDROID UA (WEB URLs often return empty)
          const capRes = await fetch(track.baseUrl, {
            headers: { 'User-Agent': ANDROID_UA },
          })
          const xml = await capRes.text()
          if (!xml || xml.length < 50) throw new Error('Caption XML empty')

          const lines = parseXml(xml)
          if (lines.length === 0) throw new Error('Parsed transcript empty')

          console.log(`[transcript] ✓ ${lines.length} lines via page scrape`)
          return lines.join('\n')
        } catch (e) {
          if (e.message.includes('lines via')) throw e // success path — re-throw to exit
          throw new Error(`JSON parse failed: ${e.message}`)
        }
      }
    }
  }
  throw new Error('Could not parse ytInitialPlayerResponse')
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function getTranscriptWithFallback(videoId) {
  const transcript = await fetchTranscript(videoId)
  return { transcript, source: 'captions' }
}

export async function fetchTranscript(videoId) {
  // Strategy 1: ANDROID InnerTube client (most reliable from serverless)
  try {
    return await fetchViaAndroidInnerTube(videoId)
  } catch (err) {
    console.log(`[transcript] ANDROID InnerTube failed: ${err.message}`)
  }

  // Strategy 2: Page scrape fallback
  try {
    return await fetchViaPageScrape(videoId)
  } catch (err) {
    console.log(`[transcript] Page scrape failed: ${err.message}`)
  }

  throw new Error('No transcript available for this video.')
}
