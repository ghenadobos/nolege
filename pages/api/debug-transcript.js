export const config = { runtime: 'edge' }

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v') || 'pEfrdAtAmqk'
  const results = {}

  // Step 1: Fetch page, capture response cookies + session data
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+999',
    },
  })
  const html = await pageRes.text()

  // Capture all cookies from the page response
  const setCookieHeaders = pageRes.headers.getSetCookie?.() || []
  const responseCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ')
  const fullCookieStr = 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; ' + responseCookies

  results.cookies = {
    count: setCookieHeaders.length,
    cookieStr: fullCookieStr.slice(0, 200),
  }

  // Extract session data from HTML
  const visitorMatch = html.match(/"VISITOR_DATA":"([^"]+)"/)
  const visitorData = visitorMatch?.[1]
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  const apiKey = apiKeyMatch?.[1]
  const sessionIdxMatch = html.match(/"LOGGED_IN_SESSION_INDEX":"?(\d+)"?/)
  const datasyncIdMatch = html.match(/"DATASYNC_ID":"([^"]*)"/)

  results.sessionData = {
    hasVisitorData: !!visitorData,
    visitorData: visitorData?.slice(0, 40),
    apiKey,
    hasSessionIdx: !!sessionIdxMatch,
    hasDatasyncId: !!datasyncIdMatch,
  }

  // Extract transcript params from ytInitialData
  const paramMatch = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/)
  const transcriptParams = paramMatch?.[1]
  results.hasTranscriptParams = !!transcriptParams

  if (transcriptParams && visitorData) {
    // Step 2: Call get_transcript with FULL session context
    try {
      const url = 'https://www.youtube.com/youtubei/v1/get_transcript' + (apiKey ? '?key=' + apiKey : '')
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Cookie': fullCookieStr,
          'X-Youtube-Client-Name': '1',
          'X-Youtube-Client-Version': '2.20240530.02.00',
          'X-Goog-Visitor-Id': visitorData,
          'Origin': 'https://www.youtube.com',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240530.02.00',
              hl: 'en',
              gl: 'US',
              visitorData,
            },
          },
          params: transcriptParams,
        }),
      })

      const data = await res.json()
      const actions = data?.actions || []
      const panel = actions.find(a => a.updateEngagementPanelAction)
      const body = panel?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer
      const cueGroups = body?.cueGroups || []

      results.getTranscriptWithSession = {
        httpStatus: res.status,
        hasError: !!data?.error,
        errorMsg: data?.error?.message?.slice(0, 100),
        errorStatus: data?.error?.status,
        actionCount: actions.length,
        cueGroupCount: cueGroups.length,
      }

      if (cueGroups.length > 0) {
        const firstCue = cueGroups[0]?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer
        results.getTranscriptWithSession.firstCueText = firstCue?.cue?.simpleText
        results.getTranscriptWithSession.SUCCESS = true
      }

      if (data?.error) {
        results.getTranscriptWithSession.fullError = JSON.stringify(data.error).slice(0, 300)
      }
    } catch (e) {
      results.getTranscriptWithSession = { fetchError: e.message }
    }
  }

  // Also test: ANDROID player with the response cookies
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
        'Cookie': fullCookieStr,
        ...(visitorData && { 'X-Goog-Visitor-Id': visitorData }),
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38' },
          ...(visitorData && { client: { clientName: 'ANDROID', clientVersion: '20.10.38', visitorData } }),
        },
        videoId,
      }),
    })
    const data = await res.json()
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    results.androidWithSessionCookies = {
      status: data?.playabilityStatus?.status,
      reason: data?.playabilityStatus?.reason?.slice(0, 100),
      trackCount: tracks?.length || 0,
    }
    if (tracks?.length) {
      results.androidWithSessionCookies.firstTrack = tracks[0].languageCode
      // Try fetching caption
      const capRes = await fetch(tracks[0].baseUrl, {
        headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)', 'Cookie': fullCookieStr },
      })
      const xml = await capRes.text()
      results.androidWithSessionCookies.captionXmlLength = xml.length
      if (xml.length > 100) results.androidWithSessionCookies.SUCCESS = true
    }
  } catch (e) {
    results.androidWithSessionCookies = { error: e.message }
  }

  return new Response(JSON.stringify({ videoId, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
