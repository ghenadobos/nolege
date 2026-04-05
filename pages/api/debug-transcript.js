// Diagnostic endpoint to test YouTube access from Vercel's servers
// Visit: /api/debug-transcript?v=pEfrdAtAmqk

export const config = { runtime: 'edge' }

const CLIENTS = [
  {
    name: 'ANDROID',
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
  },
  {
    name: 'IOS',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.3.2.22D82' } },
  },
  {
    name: 'WEB',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    context: { client: { clientName: 'WEB', clientVersion: '2.20240530.02.00', hl: 'en', gl: 'US' } },
  },
  {
    name: 'WEB_EMBEDDED_PLAYER',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    context: { client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '2.20240530.02.00' }, thirdParty: { embedUrl: 'https://www.google.com' } },
  },
  {
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    ua: 'Mozilla/5.0',
    context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', platform: 'TV' }, thirdParty: { embedUrl: 'https://www.google.com' } },
  },
  {
    name: 'MWEB',
    ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    context: { client: { clientName: 'MWEB', clientVersion: '2.20240530.02.00' } },
  },
  {
    name: 'WEB_CREATOR',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    context: { client: { clientName: 'WEB_CREATOR', clientVersion: '1.20240530.02.00' } },
  },
]

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v') || 'pEfrdAtAmqk'

  const results = []

  for (const c of CLIENTS) {
    const entry = { client: c.name, playerStatus: null, hasTracks: false, trackCount: 0, captionFetch: null, captionLength: 0 }
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua },
        body: JSON.stringify({ context: c.context, videoId }),
      })
      const data = await res.json()
      entry.playerStatus = data?.playabilityStatus?.status || `HTTP ${res.status}`
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
      entry.hasTracks = !!tracks?.length
      entry.trackCount = tracks?.length || 0

      if (tracks?.length) {
        try {
          const capRes = await fetch(tracks[0].baseUrl, { headers: { 'User-Agent': c.ua } })
          entry.captionFetch = `HTTP ${capRes.status}`
          const xml = await capRes.text()
          entry.captionLength = xml.length
        } catch (e) {
          entry.captionFetch = `Error: ${e.message}`
        }
      }
    } catch (e) {
      entry.playerStatus = `Error: ${e.message}`
    }
    results.push(entry)
  }

  // Also test page scrape
  const scrapeEntry = { client: 'PAGE_SCRAPE', status: null, hasCaptionTracks: false, hasRecaptcha: false, hasConsent: false, pageLength: 0 }
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=PENDING+999',
      },
    })
    const html = await res.text()
    scrapeEntry.status = `HTTP ${res.status}`
    scrapeEntry.pageLength = html.length
    scrapeEntry.hasCaptionTracks = html.includes('"captionTracks"')
    scrapeEntry.hasRecaptcha = html.includes('g-recaptcha')
    scrapeEntry.hasConsent = html.includes('consent.youtube.com')
    scrapeEntry.hasPlayerResponse = html.includes('ytInitialPlayerResponse')
  } catch (e) {
    scrapeEntry.status = `Error: ${e.message}`
  }
  results.push(scrapeEntry)

  return new Response(JSON.stringify({ videoId, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
