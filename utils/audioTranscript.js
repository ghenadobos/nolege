import { statSync, readdirSync, createReadStream } from 'fs'
import { mkdir, unlink, rmdir } from 'fs/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'
import OpenAI from 'openai'

ffmpeg.setFfmpegPath(ffmpegPath)

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const CHUNK_SECS = 600          // 10-minute chunks
const MAX_BYTES  = 24 * 1024 * 1024  // 24 MB — Whisper hard limit is 25 MB

// ─── Download + convert via yt-dlp ───────────────────────────────────────────
// yt-dlp handles YouTube's signature deciphering, n-parameter obfuscation, and
// all format selection automatically. It uses our bundled ffmpeg for conversion.
// Install: pip install yt-dlp  (or: winget install yt-dlp)

async function getAudioMp3(videoId, workDir) {
  const mp3Path = join(workDir, 'audio.mp3')

  await new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',          // VBR ~130 kbps — more than enough for speech
        '--ffmpeg-location', dirname(ffmpegPath),  // use our bundled ffmpeg binary
        '-o', mp3Path,
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--no-progress',
      ],
      { timeout: 300_000 },
      (err, _stdout, stderr) => {
        if (!err) return resolve()
        if (err.code === 'ENOENT') {
          reject(new Error(
            'yt-dlp is not installed. Run: pip install yt-dlp  (then restart the dev server)'
          ))
        } else {
          reject(new Error(`yt-dlp failed: ${stderr?.trim() || err.message}`))
        }
      }
    )
  })

  return mp3Path
}

// ─── Split into ≤24 MB chunks ─────────────────────────────────────────────────

async function splitAudio(mp3Path, workDir) {
  const chunkPattern = join(workDir, 'chunk_%03d.mp3')
  await new Promise((resolve, reject) => {
    ffmpeg(mp3Path)
      .outputOptions([
        '-f segment',
        `-segment_time ${CHUNK_SECS}`,
        '-c copy',
        '-reset_timestamps 1',
      ])
      .output(chunkPattern)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`ffmpeg split failed: ${err.message}`)))
      .run()
  })

  return readdirSync(workDir)
    .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
    .sort()
    .map(f => join(workDir, f))
}

// ─── Transcribe one chunk via Whisper ────────────────────────────────────────

async function transcribeChunk(filePath, chunkIndex) {
  const response = await client.audio.transcriptions.create({
    file: createReadStream(filePath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  })

  const offsetSecs = chunkIndex * CHUNK_SECS

  if (response.segments?.length) {
    return response.segments.map(seg => {
      const total = Math.floor(seg.start) + offsetSecs
      const mm = Math.floor(total / 60).toString().padStart(2, '0')
      const ss = (total % 60).toString().padStart(2, '0')
      return `[${mm}:${ss}] ${seg.text.trim()}`
    }).join('\n')
  }

  // Fallback: no segment timestamps
  return response.text?.trim() || ''
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function generateTranscriptFromAudio(videoId) {
  const workDir = join(tmpdir(), `yt-audio-${videoId}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  try {
    console.log(`[audio] downloading audio for ${videoId}…`)
    const mp3Path = await getAudioMp3(videoId, workDir)

    const { size } = statSync(mp3Path)
    console.log(`[audio] mp3 size: ${(size / 1024 / 1024).toFixed(1)} MB`)

    const chunks = size > MAX_BYTES
      ? await splitAudio(mp3Path, workDir)
      : [mp3Path]

    console.log(`[audio] transcribing ${chunks.length} chunk(s)…`)
    const parts = []
    for (let i = 0; i < chunks.length; i++) {
      parts.push(await transcribeChunk(chunks[i], i))
    }

    const transcript = parts.filter(Boolean).join('\n')
    if (!transcript.trim()) throw new Error('Transcription produced no text.')

    console.log(`[audio] done — ${transcript.split('\n').length} lines`)
    return transcript
  } finally {
    // Best-effort temp file cleanup
    try {
      const files = readdirSync(workDir)
      await Promise.all(files.map(f => unlink(join(workDir, f)).catch(() => {})))
      await rmdir(workDir).catch(() => {})
    } catch {}
  }
}
