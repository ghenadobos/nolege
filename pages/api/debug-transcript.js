export const config = { runtime: 'edge' }

export default async function handler(req) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('v') || 'pEfrdAtAmqk'
  const results = {}

  // Fetch YouTube page and deeply inspect the player response
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB',
      },
    })
    const html = await res.text()

    // Extract ytInitialPlayerResponse
    const marker = 'var ytInitialPlayerResponse = '
    const startIdx = html.indexOf(marker)
    if (startIdx !== -1) {
      let depth = 0
      const jsonStart = startIdx + marker.length
      for (let i = jsonStart; i < Math.min(jsonStart + 500000, html.length); i++) {
        if (html[i] === '{') depth++
        else if (html[i] === '}') {
          depth--
          if (depth === 0) {
            try {
              const pr = JSON.parse(html.slice(jsonStart, i + 1))
              results.playerResponse = {
                keys: Object.keys(pr),
                playabilityStatus: pr.playabilityStatus?.status,
                playabilityReason: pr.playabilityStatus?.reason?.slice(0, 150),
                hasCaptions: !!pr.captions,
                captionKeys: pr.captions ? Object.keys(pr.captions) : [],
                captionTracksCount: pr.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
              }
              // Look for captions in ANY nested object
              const jsonStr = JSON.stringify(pr)
              results.playerResponse.containsCaptionTracks = jsonStr.includes('captionTracks')
              results.playerResponse.containsTimedtext = jsonStr.includes('timedtext')
              results.playerResponse.containsBaseUrl = jsonStr.includes('baseUrl')
              results.playerResponse.containsTranscript = jsonStr.includes('transcript')
            } catch (e) {
              results.playerResponse = { parseError: e.message }
            }
            break
          }
        }
      }
    } else {
      results.playerResponse = 'not found in HTML'
    }

    // Also check ytInitialData for transcript panel
    const dataMarker = 'var ytInitialData = '
    const dataIdx = html.indexOf(dataMarker)
    if (dataIdx !== -1) {
      let depth = 0
      const jsonStart = dataIdx + dataMarker.length
      for (let i = jsonStart; i < Math.min(jsonStart + 2000000, html.length); i++) {
        if (html[i] === '{') depth++
        else if (html[i] === '}') {
          depth--
          if (depth === 0) {
            try {
              const id = JSON.parse(html.slice(jsonStart, i + 1))
              const idStr = JSON.stringify(id)
              results.initialData = {
                containsTranscript: idStr.includes('transcript'),
                containsGetTranscript: idStr.includes('getTranscriptEndpoint'),
                containsCaptions: idStr.includes('captions'),
              }
              // Extract getTranscriptEndpoint params if present
              const paramMatch = idStr.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/)
              if (paramMatch) {
                results.initialData.transcriptParams = paramMatch[1].slice(0, 100)
              }
            } catch (e) {
              results.initialData = { parseError: e.message }
            }
            break
          }
        }
      }
    }

    // Check for caption-related strings anywhere in the page
    results.htmlSearch = {
      pageLength: html.length,
      captionTracks: html.includes('"captionTracks"'),
      timedtext: html.includes('timedtext'),
      transcript: html.includes('transcript'),
      getTranscriptEndpoint: html.includes('getTranscriptEndpoint'),
      showTranscript: html.includes('Show transcript'),
      playerCaptions: html.includes('playerCaptions'),
    }
  } catch (e) {
    results.error = e.message
  }

  // Test get_transcript with params from the page (if found)
  if (results.initialData?.transcriptParams) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnsBhAB',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240530.02.00', hl: 'en', gl: 'US' } },
          params: results.initialData.transcriptParams,
        }),
      })
      const data = await res.json()
      const actions = data?.actions || []
      const panel = actions.find(a => a.updateEngagementPanelAction)
      const cueGroups = panel?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer?.cueGroups || []
      results.getTranscript = {
        httpStatus: res.status,
        hasError: !!data?.error,
        errorMsg: data?.error?.message?.slice(0, 100),
        actionCount: actions.length,
        cueGroupCount: cueGroups.length,
      }
      if (cueGroups.length > 0) {
        const firstCue = cueGroups[0]?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer
        results.getTranscript.firstCueText = firstCue?.cue?.simpleText?.slice(0, 50)
      }
    } catch (e) {
      results.getTranscript = { error: e.message }
    }
  }

  return new Response(JSON.stringify({ videoId, results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
