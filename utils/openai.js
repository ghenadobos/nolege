import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ═══════════════════════════════════════════════════════════════════════════════
// SAFE JSON PARSING — every AI response goes through this
// ═══════════════════════════════════════════════════════════════════════════════

function safeParseJSON(raw, context = 'unknown') {
  try {
    return { ok: true, data: JSON.parse(raw) }
  } catch (err) {
    console.error(`[json] parse failed in ${context}: ${err.message}`)
    console.error(`[json] raw (first 500 chars): ${(raw || '').slice(0, 500)}`)
    return { ok: false, data: null, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLE MODE PROMPTS (non-study-pack)
// ═══════════════════════════════════════════════════════════════════════════════

const PROMPTS = {
  'action-steps': `You are a practical assistant.
Extract ONLY concrete, executable actions from this video.
Respond ONLY with valid JSON:
{"goal":"string","steps":["string"],"mistakes":["string"]}`,

  'summary': `Summarize this video concisely. 3–5 bullet points, max 1 sentence each.
Respond ONLY with valid JSON:
{"bullets":["string"]}`,

  'key-insights': `Extract 3–5 non-obvious, valuable insights from this video.
Respond ONLY with valid JSON:
{"insights":[{"insight":"string","why":"string"}]}`,

  'study-notes': `Turn this video into structured study notes with topics, key points, and a quick review.
Respond ONLY with valid JSON:
{"topics":[{"title":"string","points":["string"]}],"quickReview":"string"}`,

  'study-pack': `Placeholder — study-pack uses the multi-step pipeline below.`,

  'decision-help': `Help the user make a decision based on this video: what is evaluated, pros, cons, final take.
Respond ONLY with valid JSON:
{"evaluated":"string","pros":["string"],"cons":["string"],"finalTake":"string"}`,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PER-LEARNING-TYPE PRACTICE INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const PRACTICE_INSTRUCTIONS = {
  coding: `PRACTICE EXERCISES (coding/technical):
Generate 1–2 exercises per section using ONLY these types:
- predict_output: code snippet in "code", 4 MC options, correct answer letter
- write_code: ask user to write function/query, include referenceAnswer + evaluationRubric
- fix_code: buggy code in "code", include referenceAnswer with fix
Set practice to [] for non-technical sections.`,

  math: `PRACTICE EXERCISES (math/problem-solving):
Generate 1–2 exercises per section using ONLY these types:
- solve_problem: full problem with referenceAnswer (step-by-step) + evaluationRubric
- numeric_answer: specific numeric result, set "answer" to exact value
- explain_steps: explain approach, include referenceAnswer
Set practice to [] for non-math sections.`,

  conceptual: `PRACTICE EXERCISES (conceptual/theory):
Generate 1–2 exercises per section using ONLY these types:
- short_answer: focused factual question, include referenceAnswer
- explain_concept: explain in own words, include referenceAnswer
- apply_the_idea: real scenario to apply concept, include referenceAnswer
Set practice to [] for trivial/transitional sections.`,
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY PACK PIPELINE
//
// Architecture (4 steps, no recursive retries):
//   1. Chunk transcript deterministically (~1500 chars each)
//   2. Label each chunk's topic via AI (one batched call)
//   3. Merge chunks into sections using backend rules
//   4. Generate content per section (parallel batches of 5)
//   + Lightweight validation (no extra AI calls)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Step 1: Deterministic chunking ─────────────────────────────────────────

const CHUNK_TARGET_CHARS = 1500

function chunkTranscript(transcript) {
  const lines = transcript.split('\n').filter(l => l.trim())
  if (lines.length === 0) return []

  const chunks = []
  let buf = []
  let bufLen = 0

  for (const line of lines) {
    buf.push(line)
    bufLen += line.length + 1
    if (bufLen >= CHUNK_TARGET_CHARS) {
      chunks.push(makeChunk(buf, chunks.length))
      buf = []
      bufLen = 0
    }
  }
  if (buf.length > 0) {
    chunks.push(makeChunk(buf, chunks.length))
  }
  return chunks
}

function makeChunk(lines, index) {
  const text = lines.join('\n')
  const firstTs = extractTimestamp(lines[0])
  const lastTs = extractTimestamp(lines[lines.length - 1])
  return { index, text, startTime: firstTs, endTime: lastTs, charCount: text.length }
}

function extractTimestamp(line) {
  const m = line?.match(/^\[(\d{2}:\d{2})\]/)
  return m ? m[1] : null
}

// ─── Section range heuristics ───────────────────────────────────────────────
// ~1000 chars/min for YouTube captions is a reasonable estimate.

function estimateSectionRange(charCount, chunkCount) {
  const estMin = charCount / 1000

  let lo, hi
  if (estMin < 10)       { lo = 2;  hi = 4  }
  else if (estMin < 30)  { lo = 4;  hi = 7  }
  else if (estMin < 60)  { lo = 6;  hi = 10 }
  else if (estMin < 120) { lo = 10; hi = 16 }
  else if (estMin < 240) { lo = 16; hi = 28 }
  else                   { lo = 22; hi = 40 }

  hi = Math.min(hi, chunkCount)
  lo = Math.min(lo, hi)

  return { lo, hi, estMin: Math.round(estMin) }
}

// ─── Step 2: Label each chunk's topic (one AI call) ─────────────────────────
// Ask AI for a short topic label + whether it's a new topic vs continuation.
// We send the first ~150 chars of each chunk as a preview.

async function labelChunks(chunks, language) {
  // Build compact previews
  const previews = chunks.map((c, i) => {
    const ts = c.startTime ? `[${c.startTime}] ` : ''
    const text = c.text.replace(/\n/g, ' ').slice(0, 150)
    return `${i}: ${ts}${text}`
  }).join('\n')

  console.log(`[label] sending ${chunks.length} chunk previews for topic labeling`)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `You are labeling topics for a video transcript split into ${chunks.length} sequential chunks.

For each chunk, return:
- topic: short specific topic name (e.g. "SQL WHERE Clause", "React State Management")
- newTopic: true if this chunk starts a NEW topic, false if it continues the previous chunk's topic

CHUNK PREVIEWS:
${previews}

Output language for topic names: ${language}

Respond ONLY with valid JSON:
{"labels":[{"topic":"string","newTopic":true}]}

You MUST return exactly ${chunks.length} labels, one per chunk, in order.`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.15,
  })

  const raw = response.choices[0].message.content
  const parsed = safeParseJSON(raw, 'labelChunks')

  if (!parsed.ok || !Array.isArray(parsed.data?.labels)) {
    console.warn('[label] AI response invalid, falling back to uniform sections')
    return null // caller will use fallback
  }

  const labels = parsed.data.labels
  // Validate length — if AI returned wrong count, pad/trim
  if (labels.length !== chunks.length) {
    console.warn(`[label] expected ${chunks.length} labels, got ${labels.length} — using fallback`)
    return null
  }

  console.log(`[label] topics: ${labels.map(l => l.topic).join(' | ')}`)
  return labels
}

// ─── Step 3: Merge chunks into sections (backend logic) ─────────────────────
// Uses topic labels to group adjacent chunks. New topic = new section.
// Enforces min/max chunks per section based on target range.

function mergeChunksIntoSections(chunks, labels, range) {
  const sections = []
  let current = { title: labels[0]?.topic || 'Section 1', chunkIndices: [0], startTime: chunks[0]?.startTime }

  for (let i = 1; i < chunks.length; i++) {
    const label = labels[i]
    if (label?.newTopic) {
      sections.push(current)
      current = { title: label.topic || `Section ${sections.length + 2}`, chunkIndices: [i], startTime: chunks[i]?.startTime }
    } else {
      current.chunkIndices.push(i)
    }
  }
  sections.push(current)

  // If too many sections, merge smallest adjacent pairs
  while (sections.length > range.hi) {
    let minSize = Infinity
    let minIdx = 0
    for (let i = 0; i < sections.length - 1; i++) {
      const combined = sections[i].chunkIndices.length + sections[i + 1].chunkIndices.length
      if (combined < minSize) { minSize = combined; minIdx = i }
    }
    // Merge minIdx and minIdx+1
    sections[minIdx] = {
      title: sections[minIdx].title,
      chunkIndices: [...sections[minIdx].chunkIndices, ...sections[minIdx + 1].chunkIndices],
      startTime: sections[minIdx].startTime,
    }
    sections.splice(minIdx + 1, 1)
  }

  // If too few sections, split the largest ones
  while (sections.length < range.lo) {
    let maxSize = 0
    let maxIdx = 0
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].chunkIndices.length > maxSize) {
        maxSize = sections[i].chunkIndices.length
        maxIdx = i
      }
    }
    if (maxSize < 2) break // can't split single-chunk sections

    const sec = sections[maxIdx]
    const mid = Math.ceil(sec.chunkIndices.length / 2)
    const firstHalf = sec.chunkIndices.slice(0, mid)
    const secondHalf = sec.chunkIndices.slice(mid)

    // Use the topic label from the first chunk of the second half for the split title
    const secondLabel = labels[secondHalf[0]]?.topic || `${sec.title} (continued)`

    sections.splice(maxIdx, 1,
      { title: sec.title, chunkIndices: firstHalf, startTime: sec.startTime },
      { title: secondLabel, chunkIndices: secondHalf, startTime: chunks[secondHalf[0]]?.startTime }
    )
  }

  console.log(`[merge] ${sections.length} sections after merge/split (target ${range.lo}–${range.hi})`)
  return sections
}

// Fallback when AI labeling fails: split chunks evenly into sections
function uniformSections(chunks, range) {
  const target = Math.min(range.hi, Math.max(range.lo, Math.ceil(chunks.length / 3)))
  const perSection = Math.ceil(chunks.length / target)
  const sections = []
  for (let i = 0; i < chunks.length; i += perSection) {
    const indices = []
    for (let j = i; j < Math.min(i + perSection, chunks.length); j++) indices.push(j)
    sections.push({
      title: `Section ${sections.length + 1}`,
      chunkIndices: indices,
      startTime: chunks[i]?.startTime,
    })
  }
  return sections
}

// ─── Step 4: Generate content per section ───────────────────────────────────
// Each section gets its own API call with ONLY its chunk text.
// Runs in parallel batches of MAX_PARALLEL.
// Errors are isolated — a failed section produces a minimal fallback.

const MAX_PARALLEL = 5

async function generateSectionContent(sectionOutline, chunkText, learningType, language, totalSections) {
  const practiceInstr = PRACTICE_INSTRUCTIONS[learningType] || PRACTICE_INSTRUCTIONS.conceptual

  // Scale content per section based on total count
  let notes, concepts, quiz, cards, practice
  if (totalSections <= 4) {
    notes = '8–12'; concepts = '4–6'; quiz = '6–8'; cards = '6–10'; practice = '2–3'
  } else if (totalSections <= 10) {
    notes = '5–8'; concepts = '3–5'; quiz = '5–7'; cards = '4–7'; practice = '1–2'
  } else if (totalSections <= 20) {
    notes = '4–6'; concepts = '2–4'; quiz = '5–6'; cards = '3–5'; practice = '1'
  } else {
    notes = '3–5'; concepts = '2–3'; quiz = '5'; cards = '3–4'; practice = '1'
  }

  const prompt = `Generate study content for this section of a video study pack.

SECTION TITLE: "${sectionOutline.title}"

REQUIREMENTS:
- notes: ${notes} bullet points (key ideas, learning-focused)
- keyConcepts: ${concepts} terms with definitions
- quiz: ${quiz} multiple-choice questions (MINIMUM 5)
- flashcards: ${cards} Q&A pairs
- practice: ${practice} exercises

QUIZ TYPES (use all 5 if possible, at least 3 different):
concept | application | comparison | error_detection | reasoning
Each question needs: questionType, explanation, 4 options (A-D), answer (letter).

${practiceInstr}

Output language: ${language}

Respond ONLY with valid JSON:
{
  "notes":["string"],
  "keyConcepts":[{"term":"string","definition":"string"}],
  "quiz":[{"question":"string","options":["A. str","B. str","C. str","D. str"],"answer":"string","explanation":"string","questionType":"string"}],
  "flashcards":[{"question":"string","answer":"string"}],
  "practice":[{"type":"string","prompt":"string","code":"string","options":["string"],"answer":"string","explanation":"string","referenceAnswer":"string","evaluationRubric":["string"]}]
}

TRANSCRIPT:
${chunkText}`

  const estTokens = Math.round(prompt.length / 4)
  console.log(`[gen] section "${sectionOutline.title}" — ~${estTokens} input tokens`)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const raw = response.choices[0].message.content
  const parsed = safeParseJSON(raw, `section "${sectionOutline.title}"`)

  if (!parsed.ok) {
    console.error(`[gen] FAILED to parse section "${sectionOutline.title}" — returning minimal fallback`)
    return makeFallbackSection(sectionOutline)
  }

  const section = parsed.data
  // Ensure required fields exist with correct types
  return {
    title: sectionOutline.title,
    startTime: sectionOutline.startTime || section.startTime || null,
    notes: Array.isArray(section.notes) ? section.notes : [],
    keyConcepts: Array.isArray(section.keyConcepts) ? section.keyConcepts : [],
    quiz: Array.isArray(section.quiz) ? section.quiz : [],
    flashcards: Array.isArray(section.flashcards) ? section.flashcards : [],
    practice: Array.isArray(section.practice) ? section.practice : [],
  }
}

function makeFallbackSection(outline) {
  return {
    title: outline.title,
    startTime: outline.startTime || null,
    notes: ['Content generation failed for this section.'],
    keyConcepts: [],
    quiz: [],
    flashcards: [],
    practice: [],
  }
}

// ─── Lightweight validation (no extra AI calls) ─────────────────────────────

function validateSections(sections, range) {
  const log = []

  if (sections.length < range.lo) {
    log.push(`WARN: ${sections.length} sections, expected at least ${range.lo} for ~${range.estMin}min video`)
  }

  // Check for empty sections
  let emptyCount = 0
  for (const s of sections) {
    if (!s.notes?.length && !s.quiz?.length) emptyCount++
  }
  if (emptyCount > 0) {
    log.push(`WARN: ${emptyCount} section(s) have no notes and no quiz`)
  }

  // Log quiz coverage
  const totalQuiz = sections.reduce((sum, s) => sum + (s.quiz?.length || 0), 0)
  const totalCards = sections.reduce((sum, s) => sum + (s.flashcards?.length || 0), 0)
  log.push(`STATS: ${sections.length} sections, ${totalQuiz} quiz questions, ${totalCards} flashcards`)

  return log
}

// ─── Pipeline orchestrator ──────────────────────────────────────────────────

async function generateStudyPack(transcript, learningType, language) {
  const totalChars = transcript.length
  console.log(`[pack] START — ${totalChars} chars, learningType=${learningType}, language=${language}`)

  // Step 1: Deterministic chunking
  const chunks = chunkTranscript(transcript)
  console.log(`[pack] step 1: ${chunks.length} chunks`)

  if (chunks.length === 0) {
    throw new Error('Transcript is empty — cannot generate study pack')
  }

  const range = estimateSectionRange(totalChars, chunks.length)
  console.log(`[pack] estimated ~${range.estMin}min, target sections: ${range.lo}–${range.hi}`)

  // Step 2: Label each chunk's topic (one AI call)
  let sectionOutlines
  const labels = await labelChunks(chunks, language)

  if (labels) {
    // Step 3: Merge chunks into sections using backend rules
    sectionOutlines = mergeChunksIntoSections(chunks, labels, range)
  } else {
    // Fallback: uniform splitting
    console.warn('[pack] using uniform section split (labeling failed)')
    sectionOutlines = uniformSections(chunks, range)
  }

  console.log(`[pack] step 3: ${sectionOutlines.length} sections planned`)

  // Step 4: Generate content per section (parallel batches, error-isolated)
  const sections = []
  for (let batchStart = 0; batchStart < sectionOutlines.length; batchStart += MAX_PARALLEL) {
    const batch = sectionOutlines.slice(batchStart, batchStart + MAX_PARALLEL)

    const results = await Promise.allSettled(
      batch.map(outline => {
        const text = outline.chunkIndices
          .map(idx => chunks[idx]?.text || '')
          .filter(Boolean)
          .join('\n')
        return generateSectionContent(outline, text, learningType, language, sectionOutlines.length)
      })
    )

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        sections.push(results[j].value)
      } else {
        console.error(`[pack] section "${batch[j].title}" FAILED:`, results[j].reason?.message)
        sections.push(makeFallbackSection(batch[j]))
      }
    }

    console.log(`[pack] generated ${sections.length}/${sectionOutlines.length} sections`)
  }

  // Validation (logging only, no extra AI calls)
  const log = validateSections(sections, range)
  for (const msg of log) console.log(`[pack] ${msg}`)

  return { sections }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER EVALUATION (unchanged, but with safe parsing)
// ═══════════════════════════════════════════════════════════════════════════════

export async function evaluateAnswer({ question, practiceType, expectedAnswer, lessonContext, studentAnswer, language = 'English' }) {
  const systemPrompt = `You are an expert learning coach evaluating a student's answer.
Output language: ${language}.
Evaluate semantically. Distinguish correct/partial/incorrect.
Be supportive and concise. Prefer hints over full solutions.
Respond ONLY with valid JSON:
{"grade":"correct|partial|incorrect","score":0,"strengths":[],"missing":[],"misconceptions":[],"hint":"","ideal_answer":"","should_retry":false,"mastered":false,"follow_up_question":null,"flashcard":null}`

  const parts = [
    `Question: ${question}`,
    `Practice type: ${practiceType}`,
    `Expected: ${expectedAnswer}`,
  ]
  if (lessonContext) parts.push(`Context: ${lessonContext}`)
  parts.push(`Student answer: ${studentAnswer || '(empty)'}`)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: parts.join('\n') },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  const parsed = safeParseJSON(response.choices[0].message.content, 'evaluateAnswer')
  if (!parsed.ok) throw new Error('Failed to parse evaluation response')
  return parsed.data
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSCRIPT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

export async function classifyTranscript(transcript) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Classify this educational transcript. Return the dominant type:
- conceptual: theory, explanations, history, business
- coding: programming, SQL, scripting, technical implementation
- math: equations, algebra, calculus, physics calculations

Return ONLY valid JSON:
{"learningType":"conceptual","confidence":8,"reason":"..."}

INPUT:
${transcript.slice(0, 4000)}`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const parsed = safeParseJSON(response.choices[0].message.content, 'classifyTranscript')
  if (!parsed.ok) return { learningType: 'conceptual', confidence: 0, reason: 'parse failed' }
  return parsed.data
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export const DEPTHS = [
  { id: 'quick', label: 'Quick', desc: '3 quiz · 5 cards', maxMin: 20 },
  { id: 'standard', label: 'Standard', desc: '8 quiz · 12 cards', maxMin: 60 },
  { id: 'full', label: 'Full', desc: '15 quiz · 20 cards', maxMin: Infinity },
]

export function recommendDepth(durationSeconds) {
  const min = (durationSeconds || 0) / 60
  if (min < 20) return 'quick'
  if (min < 60) return 'standard'
  return 'full'
}

export const MODES = [
  { id: 'action-steps', label: 'Action Steps' },
  { id: 'summary', label: 'Summary' },
  { id: 'key-insights', label: 'Key Insights' },
  { id: 'study-notes', label: 'Study Notes' },
  { id: 'study-pack', label: 'Study Pack' },
  { id: 'decision-help', label: 'Decision Help' },
]

export async function processTranscript(transcript, mode = 'action-steps', depth = 'standard', learningType = 'conceptual', language = 'English') {
  if (mode === 'study-pack') {
    return generateStudyPack(transcript, learningType, language)
  }

  const langNote = `\n\nOutput language: ${language}.`
  const prompt = PROMPTS[mode] || PROMPTS['action-steps']

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt + langNote },
      { role: 'user', content: `INPUT:\n${transcript}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const parsed = safeParseJSON(response.choices[0].message.content, `processTranscript(${mode})`)
  if (!parsed.ok) throw new Error(`Failed to parse ${mode} response`)
  return parsed.data
}
