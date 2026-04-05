export const config = { runtime: 'edge' }

const CONSENT_COOKIES = [
  'CONSENT=YES+cb.20210328-17-p0.en+FX+999',
  'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB',
].join('; ')

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)'
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v') || 'pEfrdAtAmqk'
  const results = {}

  // Test 1: ANDROID InnerTube with consent cookies
  try {
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
    })
    const data = await res.json()
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    results.android = {
      status: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason?.slice(0, 100),
      trackCount: tracks?.length || 0,
      httpStatus: res.status,
    }
    if (tracks?.length) {
      const capRes = await fetch(tracks[0].baseUrl, {
        headers: { 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
      })
      const xml = await capRes.text()
      results.android.captionXmlLength = xml.length
      results.android.captionPreview = xml.slice(0, 100)
    }
  } catch (e) {
    results.android = { error: e.message }
  }

  // Test 2: Page scrape with consent cookies
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': WEB_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': CONSENT_COOKIES,
      },
    })
    const html = await res.text()
    const hasCaptions = html.includes('"captionTracks"')
    const hasConsent = html.includes('consent.youtube.com')
    const hasRecaptcha = html.includes('g-recaptcha')
    const hasPlayer = html.includes('ytInitialPlayerResponse')

    results.pageScrape = {
      httpStatus: res.status,
      pageLength: html.length,
      hasCaptionTracks: hasCaptions,
      hasConsent,
      hasRecaptcha,
      hasPlayerResponse: hasPlayer,
    }

    if (hasCaptions) {
      const match = html.match(/"captionTracks":(\[.*?\])/)
      if (match) {
        const tracks = JSON.parse(match[1])
        results.pageScrape.trackCount = tracks.length
        results.pageScrape.firstTrack = { lang: tracks[0].languageCode, kind: tracks[0].kind }
        // Try fetching caption
        const capRes = await fetch(tracks[0].baseUrl, {
          headers: { 'User-Agent': ANDROID_UA, 'Cookie': CONSENT_COOKIES },
        })
        const xml = await capRes.text()
        results.pageScrape.captionXmlLength = xml.length
      }
    }
  } catch (e) {
    results.pageScrape = { error: e.message }
  }

  // Test 3: ANDROID without cookies (control test)
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_UA,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId,
      }),
    })
    const data = await res.json()
    results.androidNoCookie = {
      status: data?.playabilityStatus?.status,
      trackCount: data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
    }
  } catch (e) {
    results.androidNoCookie = { error: e.message }
  }

  // Test 4: Check if Set-Cookie is even sent back (to verify cookies work in edge)
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': WEB_UA, 'Cookie': CONSENT_COOKIES },
    })
    const setCookies = res.headers.get('set-cookie') || 'none'
    results.cookieTest = {
      responseCookies: setCookies.slice(0, 200),
      sentCookieHeader: CONSENT_COOKIES.slice(0, 80),
    }
  } catch (e) {
    results.cookieTest = { error: e.message }
  }

  return new Response(JSON.stringify({ videoId, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
