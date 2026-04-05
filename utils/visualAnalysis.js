import { execFile } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdir, unlink, rmdir, readFile, stat } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import ffmpegPath from 'ffmpeg-static'
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── Visual content detection ─────────────────────────────────────────────────

const VISUAL_KEYWORDS = [
  // Geometry / math visuals
  'triangle', 'circle', 'rectangle', 'square', 'polygon', 'angle', 'parallel', 'perpendicular',
  'geometry', 'area', 'perimeter', 'volume', 'coordinate', 'axis', 'graph', 'plot', 'curve',
  'function', 'parabola', 'hyperbola', 'ellipse', 'vector', 'matrix', 'proof', 'theorem',
  // Charts / data
  'chart', 'diagram', 'table', 'figure', 'histogram', 'bar chart', 'pie chart', 'scatter',
  // Science visuals
  'molecule', 'atom', 'chemical', 'bond', 'structure', 'cell', 'anatomy', 'circuit',
  'wave', 'force', 'velocity', 'acceleration', 'reaction', 'element', 'compound',
  // Maps / geography
  'map', 'continent', 'country', 'region', 'border', 'territory',
  // Whiteboard
  'whiteboard', 'illustration', 'drawing', 'sketch', 'label', 'annotate',
  // Slides / equations
  'slide', 'equation', 'formula', 'calculation', 'derive', 'derivation',
]

export function isVisualHeavy(section) {
  const text = [
    section.title,
    ...(section.notes || []),
    ...(section.keyConcepts || []).map(c => `${c.term} ${c.definition}`),
  ].join(' ').toLowerCase()
  return VISUAL_KEYWORDS.some(kw => text.includes(kw))
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function formatTs(totalSecs) {
  const m = Math.floor(totalSecs / 60)
  const s = Math.floor(totalSecs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTimeSecs(timeStr) {
  if (!timeStr) return null
  const parts = String(timeStr).split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return parseInt(timeStr, 10) || null
}

// ─── Video URL resolution via yt-dlp ─────────────────────────────────────────

function getVideoStreamUrl(videoId) {
  return new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-f', 'best[height<=480][ext=mp4]/best[height<=480]/best',
        '--get-url',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
      ],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`yt-dlp URL failed: ${stderr?.trim() || err.message}`))
        else resolve(stdout.trim().split('\n')[0])
      }
    )
  })
}

// ─── Frame extraction via ffmpeg ──────────────────────────────────────────────

function extractFrame(streamUrl, timeSecs, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      [
        '-ss', String(timeSecs),
        '-i', streamUrl,
        '-vframes', '1',
        '-vf', 'scale=480:-1',
        '-q:v', '5',
        '-y',
        outputPath,
      ],
      { timeout: 30_000 },
      (err) => {
        if (err || !existsSync(outputPath)) reject(new Error('Frame extraction failed'))
        else resolve(outputPath)
      }
    )
  })
}

// ─── STEP 1: Extract candidate frames evenly across section ──────────────────
// Returns [{base64, ts, sizeBytes}] for each successfully extracted frame.

const NUM_CANDIDATES = 8
const MAX_SECTION_DURATION_SECS = 360  // cap at 6 min to avoid over-extracting

async function extractCandidates(streamUrl, startSecs, endSecs, workDir, prefix) {
  const duration = Math.min(endSecs - startSecs, MAX_SECTION_DURATION_SECS)
  if (duration < 20) return []  // section too short

  // Skip the first and last 8s (likely transitions/intros)
  const innerStart = startSecs + 8
  const innerEnd   = startSecs + duration - 8
  const step       = (innerEnd - innerStart) / (NUM_CANDIDATES - 1)

  const timestamps = Array.from({ length: NUM_CANDIDATES }, (_, i) =>
    Math.round(innerStart + i * step)
  )

  const candidates = []
  for (const ts of timestamps) {
    const framePath = join(workDir, `${prefix}_${ts}.jpg`)
    try {
      await extractFrame(streamUrl, ts, framePath)
      const { size } = await stat(framePath)
      const buf = await readFile(framePath)
      candidates.push({ base64: buf.toString('base64'), ts, sizeBytes: size, path: framePath })
    } catch {
      // Timestamp past end of video or extraction error — skip silently
    }
  }

  return candidates
}

// ─── STEP 2: Filter bad frames (cheap, no API) ───────────────────────────────
// Removes:
//   - too small  → blank / near-black / solid color  (< 6 KB)
//   - near-duplicate of previous frame  (within 4% file size = nearly identical content)

function filterCandidates(candidates) {
  const MIN_SIZE_BYTES = 6_000  // <6KB usually means solid color / blank frame

  const filtered = []
  for (const c of candidates) {
    // Size filter
    if (c.sizeBytes < MIN_SIZE_BYTES) {
      console.log(`[visual] drop frame @${formatTs(c.ts)}: too small (${c.sizeBytes}B)`)
      continue
    }
    // Duplicate filter: compare with previous kept frame
    if (filtered.length > 0) {
      const prev = filtered[filtered.length - 1]
      const diff = Math.abs(c.sizeBytes - prev.sizeBytes) / prev.sizeBytes
      if (diff < 0.04) {
        console.log(`[visual] drop frame @${formatTs(c.ts)}: near-duplicate of @${formatTs(prev.ts)}`)
        continue
      }
    }
    filtered.push(c)
  }
  return filtered
}

// ─── STEP 3 + 4: Score all candidates in one vision call, pick best ──────────
// Also enhances notes/quiz/flashcards (merged into one API call for efficiency).

const PREFERRED_TYPES  = new Set(['diagram', 'equation', 'graph', 'map', 'table', 'whiteboard', 'code', 'slide'])
const PENALIZED_TYPES  = new Set(['talking_head', 'irrelevant'])

async function scoreAndEnhanceSection(section, candidates) {
  const sectionText = [
    `Section title: ${section.title}`,
    section.notes?.length
      ? `Notes:\n${section.notes.slice(0, 5).map(n => `- ${n}`).join('\n')}`
      : '',
    section.keyConcepts?.length
      ? `Key concepts: ${section.keyConcepts.map(c => c.term).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n')

  // Build image content: label each candidate by index
  const imageContent = []
  for (let i = 0; i < candidates.length; i++) {
    imageContent.push({
      type: 'text',
      text: `[Screenshot ${i} — timestamp ${formatTs(candidates[i].ts)}]`,
    })
    imageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${candidates[i].base64}`, detail: 'low' },
    })
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are enhancing a study pack section. Below are ${candidates.length} candidate screenshots from different moments in a video, followed by the current section notes.

${sectionText}

---

TASK 1 — Score each screenshot for educational value.
For each screenshot index 0..${candidates.length - 1}:

imageType options: diagram | equation | graph | map | table | whiteboard | code | slide | talking_head | irrelevant
STRICT rules:
- talking_head = person speaking to camera, no educational visual → overallScore ≤ 3
- irrelevant = decorative, cinematic, empty, transition → overallScore ≤ 2
- diagram/equation/graph/whiteboard/slide/code/table = educational content → score honestly
- relevanceScore: does the image relate to the section topic? (1–10)
- educationalValueScore: does it help a learner understand the concept? (1–10)
- overallScore: overall quality as a study screenshot (1–10)

TASK 2 — Enhance study content using the BEST educational screenshot (if one exists).
If all screenshots are talking_head or irrelevant, still generate enhanced notes from the transcript alone.

For visualSummary: ONLY describe what educational object is visible (e.g. "A labeled diagram showing...").
NEVER write "this screenshot is not directly relevant" or describe a person talking. If no useful screenshot exists, set visualSummary to null.

Respond ONLY with valid JSON:
{
  "screenshots": [
    {
      "index": 0,
      "imageType": "...",
      "relevanceScore": 1-10,
      "clarityScore": 1-10,
      "educationalValueScore": 1-10,
      "overallScore": 1-10,
      "reason": "..."
    }
  ],
  "bestIndex": <integer — index of best screenshot, or -1 if none are educational>,
  "notes": ["string"],
  "keyConcepts": [{"term": "string", "definition": "string"}],
  "quiz": [{"question": "string", "options": ["A. string","B. string","C. string","D. string"], "answer": "string"}],
  "flashcards": [{"question": "string", "answer": "string"}],
  "visualSummary": "1–2 sentences describing the educational content visible in the best screenshot, or null"
}`,
          },
          ...imageContent,
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
    temperature: 0.2,
  })

  const result = JSON.parse(response.choices[0].message.content)

  // Apply type-based score correction (force cap on penalized types regardless of model leniency)
  const scores = result.screenshots || []
  const corrected = scores.map(s => {
    let score = s.overallScore ?? 5
    if (PENALIZED_TYPES.has(s.imageType)) score = Math.min(score, 3)
    if (PREFERRED_TYPES.has(s.imageType)) score = Math.max(score, s.overallScore)
    return { ...s, overallScore: score }
  })

  console.log('[visual] all scores:', corrected.map(s =>
    `${s.index}(${s.imageType} rel=${s.relevanceScore} edu=${s.educationalValueScore} overall=${s.overallScore})`
  ).join(' | '))

  // Hard-reject conditions — these types are NEVER shown regardless of score
  const HARD_REJECT_TYPES = new Set(['talking_head', 'irrelevant'])

  // Validity thresholds — must pass ALL to be eligible
  const RELEVANCE_MIN    = 7
  const EDU_VALUE_MIN    = 7

  function isEligible(s) {
    if (HARD_REJECT_TYPES.has(s.imageType)) return false
    if ((s.relevanceScore ?? 0) < RELEVANCE_MIN)  return false
    if ((s.educationalValueScore ?? 0) < EDU_VALUE_MIN) return false
    return true
  }

  // Try to find the best eligible candidate
  const eligible = corrected
    .filter(isEligible)
    .sort((a, b) => b.overallScore - a.overallScore)

  if (eligible.length === 0) {
    console.log('[visual] no candidate passed threshold — screenshot suppressed')
    return { result, bestIndex: null, bestScore: null }
  }

  const bestScore = eligible[0]
  const bestIndex = bestScore.index

  // Clamp to valid range as a safety net
  if (bestIndex < 0 || bestIndex >= candidates.length) {
    console.log('[visual] bestIndex out of range — screenshot suppressed')
    return { result, bestIndex: null, bestScore: null }
  }

  console.log(
    `[visual] selected screenshot: index ${bestIndex} @${formatTs(candidates[bestIndex].ts)}` +
    ` type=${bestScore.imageType} rel=${bestScore.relevanceScore} edu=${bestScore.educationalValueScore} overall=${bestScore.overallScore}`
  )

  return { result, bestIndex, bestScore }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function enhancePackWithVisuals(videoId, sections) {
  const workDir = join(tmpdir(), `yt-visual-${videoId}-${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  const enhanced = sections.map(s => ({ ...s }))
  let streamUrl = null
  let anyEnhanced = false

  try {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      if (!isVisualHeavy(section)) continue

      const startSecs = parseTimeSecs(section.startTime)
      if (startSecs === null) {
        console.log(`[visual] section ${i + 1} has no startTime, skipping`)
        continue
      }

      // Determine end of this section (next section start or +5 min fallback)
      const nextSection = sections[i + 1]
      const endSecs = parseTimeSecs(nextSection?.startTime) ?? (startSecs + 300)

      // Resolve stream URL lazily on first visual section
      if (!streamUrl) {
        try {
          streamUrl = await getVideoStreamUrl(videoId)
        } catch (err) {
          console.warn('[visual] could not get stream URL:', err.message)
          break
        }
      }

      // ── STEP 1: Extract candidates ────────────────────────────────────────
      const prefix = `s${i}`
      let candidates = await extractCandidates(streamUrl, startSecs, endSecs, workDir, prefix)
      console.log(`[visual] section ${i + 1}: extracted ${candidates.length} candidate frames`)

      if (!candidates.length) continue

      // ── STEP 2: Filter bad frames ─────────────────────────────────────────
      const filtered = filterCandidates(candidates)
      console.log(`[visual] section ${i + 1}: ${filtered.length} frames after filtering`)

      // Fallback: if filtering removed everything, use size-ordered originals
      const toScore = filtered.length > 0 ? filtered : candidates.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 4)

      // Limit to 6 to keep token usage bounded
      const finalCandidates = toScore.slice(0, 6)

      // ── STEP 3 + 4: Score + enhance in one API call ───────────────────────
      try {
        const { result, bestIndex, bestScore } = await scoreAndEnhanceSection(section, finalCandidates)

        // bestIndex is null when no candidate passed the validity threshold
        const bestCandidate = bestIndex !== null ? finalCandidates[bestIndex] : null
        const visualContext = {
          isVisualHeavy: true,
          // screenshot is null when suppressed — UI must check before rendering
          screenshot: bestCandidate ? {
            timestamp: formatTs(bestCandidate.ts),
            imageUrl:  `data:image/jpeg;base64,${bestCandidate.base64}`,
            imageType: bestScore.imageType || null,
            caption:   result.visualSummary || null,
          } : null,
        }

        enhanced[i] = {
          ...section,
          notes:            result.notes       || section.notes,
          keyConcepts:      result.keyConcepts || section.keyConcepts,
          quiz:             result.quiz        || section.quiz,
          flashcards:       result.flashcards  || section.flashcards,
          visualSummary:    bestCandidate ? (result.visualSummary || null) : null,
          visuallyEnhanced: true,
          visualContext,
        }
        anyEnhanced = true
        console.log(`[visual] enhanced section ${i + 1}: "${section.title}" screenshot=${bestCandidate ? 'shown' : 'suppressed'}`)
      } catch (err) {
        console.warn(`[visual] enhancement failed for section ${i + 1}:`, err.message)
      }
    }
  } finally {
    try {
      const files = readdirSync(workDir)
      await Promise.all(files.map(f => unlink(join(workDir, f)).catch(() => {})))
      await rmdir(workDir).catch(() => {})
    } catch {}
  }

  return { sections: enhanced, visuallyEnhanced: anyEnhanced }
}
