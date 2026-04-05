// ╔══════════════════════════════════════════════════════════════════════╗
// ║  YouTube Transcript Proxy — Google Apps Script                      ║
// ║                                                                     ║
// ║  SETUP:                                                             ║
// ║  1. Go to https://script.google.com                                 ║
// ║  2. Click "New project"                                             ║
// ║  3. Delete the default code, paste THIS ENTIRE FILE                 ║
// ║  4. Click Deploy → New deployment                                   ║
// ║  5. Type = "Web app"                                                ║
// ║  6. Execute as = "Me"                                               ║
// ║  7. Who has access = "Anyone"                                       ║
// ║  8. Click Deploy → copy the URL                                     ║
// ║  9. In Vercel dashboard → Settings → Environment Variables:         ║
// ║     Add TRANSCRIPT_PROXY_URL = <the URL you copied>                 ║
// ║  10. Redeploy your Vercel app                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

function doGet(e) {
  var videoId = e.parameter.v;
  if (!videoId) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Missing ?v= parameter" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // Fetch YouTube watch page (Google's servers → YouTube = same company, no blocking)
    var response = UrlFetchApp.fetch("https://www.youtube.com/watch?v=" + videoId, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+999"
      },
      followRedirects: true,
      muteHttpExceptions: true
    });

    var html = response.getContentText();

    // Extract captionTracks from ytInitialPlayerResponse
    var match = html.match(/"captionTracks":(\[.*?\])/);
    if (!match) {
      // Try ANDROID InnerTube as fallback
      return tryAndroidInnerTube(videoId);
    }

    var tracks = JSON.parse(match[1]);
    if (!tracks || tracks.length === 0) {
      return tryAndroidInnerTube(videoId);
    }

    // Pick best English track
    var track = null;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].languageCode === "en" && tracks[i].kind !== "asr") { track = tracks[i]; break; }
    }
    if (!track) {
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].languageCode === "en") { track = tracks[i]; break; }
      }
    }
    if (!track) {
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].languageCode && tracks[i].languageCode.indexOf("en") === 0) { track = tracks[i]; break; }
      }
    }
    if (!track) track = tracks[0];

    // Fetch caption XML
    var capResponse = UrlFetchApp.fetch(track.baseUrl, { muteHttpExceptions: true });
    var xml = capResponse.getContentText();

    if (!xml || xml.length < 50) {
      return tryAndroidInnerTube(videoId);
    }

    // Parse XML to transcript lines
    var lines = parseXml(xml);
    if (lines.length === 0) {
      return tryAndroidInnerTube(videoId);
    }

    return ContentService.createTextOutput(JSON.stringify({
      transcript: lines.join("\n"),
      source: "google-apps-script",
      lines: lines.length
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // Try ANDROID InnerTube as fallback
    try {
      return tryAndroidInnerTube(videoId);
    } catch (err2) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "Failed: " + err.message + " | " + err2.message
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }
}

function tryAndroidInnerTube(videoId) {
  var response = UrlFetchApp.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "post",
    contentType: "application/json",
    headers: {
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)"
    },
    payload: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId: videoId
    }),
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());

  if (data.playabilityStatus && data.playabilityStatus.status !== "OK") {
    throw new Error("Video status: " + data.playabilityStatus.status);
  }

  var tracks = data.captions && data.captions.playerCaptionsTracklistRenderer
    && data.captions.playerCaptionsTracklistRenderer.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error("No caption tracks found");
  }

  var track = null;
  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].languageCode === "en") { track = tracks[i]; break; }
  }
  if (!track) track = tracks[0];

  var capResponse = UrlFetchApp.fetch(track.baseUrl, {
    headers: { "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14)" },
    muteHttpExceptions: true
  });
  var xml = capResponse.getContentText();

  var lines = parseXml(xml);
  if (lines.length === 0) throw new Error("Parsed 0 lines from caption XML");

  return ContentService.createTextOutput(JSON.stringify({
    transcript: lines.join("\n"),
    source: "google-apps-script-android",
    lines: lines.length
  })).setMimeType(ContentService.MimeType.JSON);
}

function parseXml(xml) {
  var lines = [];

  // Try ANDROID format: <p t="ms" d="ms"><s>text</s></p>
  var pRe = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  var pm;
  while ((pm = pRe.exec(xml)) !== null) {
    var startMs = parseInt(pm[1], 10);
    var inner = pm[3];
    var text = "";
    var sRe = /<s[^>]*>([^<]*)<\/s>/g;
    var sm;
    while ((sm = sRe.exec(inner)) !== null) text += sm[1];
    if (!text) text = inner.replace(/<[^>]+>/g, "");
    text = decodeHtml(text).trim();
    var sec = Math.floor(startMs / 1000);
    var mm = pad(Math.floor(sec / 60));
    var ss = pad(sec % 60);
    if (text) lines.push("[" + mm + ":" + ss + "] " + text);
  }
  if (lines.length > 0) return lines;

  // Classic format: <text start="sec" dur="sec">text</text>
  var re = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var text = decodeHtml(m[2]);
    var sec = Math.floor(parseFloat(m[1]));
    var mm = pad(Math.floor(sec / 60));
    var ss = pad(sec % 60);
    if (text) lines.push("[" + mm + ":" + ss + "] " + text);
  }
  return lines;
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim();
}
