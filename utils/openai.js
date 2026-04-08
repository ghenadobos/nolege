import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// gpt-4o-mini for fast pipeline steps (labeling, section gen) — 5x faster than gpt-4o
// gpt-4o only for answer evaluation where quality matters most
const FAST_MODEL = 'gpt-4o-mini'
const QUALITY_MODEL = 'gpt-4o'

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
//   4. Generate content in batches (3 sections/call, parallel waves)
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
  // For very large transcripts, reduce preview length to keep prompt reasonable
  const previewLen = chunks.length > 60 ? 100 : 150

  const previews = chunks.map((c, i) => {
    const ts = c.startTime ? `[${c.startTime}] ` : ''
    const text = c.text.replace(/\n/g, ' ').slice(0, previewLen)
    return `${i}: ${ts}${text}`
  }).join('\n')

  console.log(`[label] sending ${chunks.length} chunk previews (${previewLen} chars each)`)

  const response = await client.chat.completions.create({
    model: FAST_MODEL,
    messages: [{
      role: 'user',
      content: `Label topics for a video transcript split into ${chunks.length} chunks.

For each chunk return:
- topic: short specific name (e.g. "SQL WHERE Clause", "React State Management")
- newTopic: true if this chunk starts a NEW topic, false if it continues the previous one

CHUNKS:
${previews}

Language for topic names: ${language}

Return ONLY valid JSON:
{"labels":[{"topic":"string","newTopic":true}]}

Return exactly ${chunks.length} labels in order.`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.15,
  })

  const raw = response.choices[0].message.content
  const parsed = safeParseJSON(raw, 'labelChunks')

  if (!parsed.ok || !Array.isArray(parsed.data?.labels)) {
    console.warn('[label] AI response invalid, falling back to uniform sections')
    return null
  }

  let labels = parsed.data.labels

  // If AI returned fewer labels, pad with continuation markers
  if (labels.length < chunks.length) {
    console.warn(`[label] expected ${chunks.length} labels, got ${labels.length} — padding`)
    const lastTopic = labels[labels.length - 1]?.topic || 'Continuation'
    while (labels.length < chunks.length) {
      labels.push({ topic: lastTopic, newTopic: false })
    }
  }
  // If too many, trim
  if (labels.length > chunks.length) {
    labels = labels.slice(0, chunks.length)
  }

  const newTopicCount = labels.filter(l => l.newTopic).length
  console.log(`[label] ${newTopicCount} topic transitions detected across ${chunks.length} chunks`)
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

const SECTIONS_PER_CALL = 3   // sections generated per single API call
const MAX_PARALLEL_CALLS = 2  // keep low — free-tier gpt-4o-mini allows only 3 RPM
const MAX_SECTIONS = 12       // hard cap for Vercel 60s timeout

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
    model: FAST_MODEL,
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

// ─── Batch content generation ───────────────────────────────────────────────
// Multiple sections per API call — reduces total calls from N to ceil(N/3).
// E.g., 12 sections → 4 API calls instead of 12. All fit in 1 parallel wave.

async function generateBatchContent(sectionGroup, chunks, learningType, language, totalSections) {
  const practiceInstr = PRACTICE_INSTRUCTIONS[learningType] || PRACTICE_INSTRUCTIONS.conceptual

  let notesN, conceptsN, quizN, cardsN
  if (totalSections <= 4) {
    notesN = '8-12'; conceptsN = '4-6'; quizN = '6-8'; cardsN = '6-10'
  } else if (totalSections <= 10) {
    notesN = '5-8'; conceptsN = '3-5'; quizN = '5-7'; cardsN = '4-7'
  } else {
    notesN = '3-5'; conceptsN = '2-3'; quizN = '4-5'; cardsN = '3-4'
  }

  const sectionBlocks = sectionGroup.map((outline, idx) => {
    const text = outline.chunkIndices
      .map(i => chunks[i]?.text || '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 6000)
    return `=== SECTION ${idx + 1}: "${outline.title}" ===\n${text}`
  })

  const prompt = `Generate study content for ${sectionGroup.length} sections of a video transcript.

Per section produce:
- notes: ${notesN} bullet points (key learning ideas)
- keyConcepts: ${conceptsN} terms with definitions
- quiz: ${quizN} multiple-choice (4 options A-D, answer letter, explanation, questionType: concept|application|comparison|error_detection|reasoning)
- flashcards: ${cardsN} Q&A pairs
- practice: 1 exercise

${practiceInstr}

Language: ${language}

Return ONLY valid JSON with exactly ${sectionGroup.length} sections in order:
{"sections":[{"notes":["..."],"keyConcepts":[{"term":"...","definition":"..."}],"quiz":[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","explanation":"...","questionType":"concept"}],"flashcards":[{"question":"...","answer":"..."}],"practice":[{"type":"short_answer","prompt":"...","referenceAnswer":"..."}]}]}

TRANSCRIPT BY SECTION:
${sectionBlocks.join('\n\n')}`

  const estTokens = Math.round(prompt.length / 4)
  console.log(`[gen] batch of ${sectionGroup.length} sections — ~${estTokens} input tokens`)

  const response = await client.chat.completions.create({
    model: FAST_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const raw = response.choices[0].message.content
  const parsed = safeParseJSON(raw, `batch[${sectionGroup.map(s => s.title).join(', ')}]`)

  if (!parsed.ok) {
    console.error(`[gen] batch JSON parse failed — ${sectionGroup.length} sections get fallback`)
    return sectionGroup.map(o => makeFallbackSection(o))
  }

  // Try to find sections array — model may use different keys
  let sectionsArr = parsed.data?.sections
  if (!Array.isArray(sectionsArr)) {
    // Try common alternatives: root-level array, or first array value found
    const vals = Object.values(parsed.data || {})
    sectionsArr = vals.find(v => Array.isArray(v))
  }
  if (!Array.isArray(sectionsArr)) {
    console.error(`[gen] batch response missing sections array — keys: ${Object.keys(parsed.data || {}).join(', ')}`)
    console.error(`[gen] response preview: ${raw.slice(0, 300)}`)
    return sectionGroup.map(o => makeFallbackSection(o))
  }

  return sectionGroup.map((outline, idx) => {
    const s = sectionsArr[idx]
    if (!s) return makeFallbackSection(outline)
    return {
      title: outline.title,
      startTime: outline.startTime || null,
      notes: Array.isArray(s.notes) ? s.notes : [],
      keyConcepts: Array.isArray(s.keyConcepts) ? s.keyConcepts : [],
      quiz: Array.isArray(s.quiz) ? s.quiz : [],
      flashcards: Array.isArray(s.flashcards) ? s.flashcards : [],
      practice: Array.isArray(s.practice) ? s.practice : [],
    }
  })
}

async function generateBatchWithRetry(group, chunks, learningType, language, totalSections) {
  try {
    return await generateBatchContent(group, chunks, learningType, language, totalSections)
  } catch (err) {
    const status = err?.status || err?.response?.status || 'unknown'
    console.warn(`[gen] batch failed (status=${status}): ${err.message}`)
    // Wait longer on rate limit (429)
    const delay = status === 429 ? 5000 : 2000
    console.warn(`[gen] retrying in ${delay}ms...`)
    await new Promise(r => setTimeout(r, delay))
    try {
      return await generateBatchContent(group, chunks, learningType, language, totalSections)
    } catch (retryErr) {
      const retryStatus = retryErr?.status || retryErr?.response?.status || 'unknown'
      console.error(`[gen] retry also failed (status=${retryStatus}): ${retryErr.message}`)
      return group.map(o => makeFallbackSection(o))
    }
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
  console.log(`[pack] v2 START — ${totalChars} chars, learningType=${learningType}, language=${language}`)

  // Step 1: Deterministic chunking
  const chunks = chunkTranscript(transcript)
  console.log(`[pack] step 1: ${chunks.length} chunks`)

  if (chunks.length === 0) {
    throw new Error('Transcript is empty — cannot generate study pack')
  }

  const range = estimateSectionRange(totalChars, chunks.length)
  console.log(`[pack] estimated ~${range.estMin}min, target sections: ${range.lo}–${range.hi}`)

  // Step 2: Label each chunk's topic (one AI call, with fallback)
  let sectionOutlines
  let labels = null
  try {
    labels = await labelChunks(chunks, language)
  } catch (err) {
    console.error(`[pack] labelChunks threw: ${err.message}`)
  }

  if (labels) {
    // Step 3: Merge chunks into sections using backend rules
    sectionOutlines = mergeChunksIntoSections(chunks, labels, range)
  } else {
    // Fallback: uniform splitting
    console.warn('[pack] using uniform section split (labeling failed)')
    sectionOutlines = uniformSections(chunks, range)
  }

  // Cap sections to stay within Vercel 60s timeout
  if (sectionOutlines.length > MAX_SECTIONS) {
    console.warn(`[pack] capping ${sectionOutlines.length} sections to ${MAX_SECTIONS}`)
    while (sectionOutlines.length > MAX_SECTIONS) {
      let minSize = Infinity, minIdx = 0
      for (let i = 0; i < sectionOutlines.length - 1; i++) {
        const combined = sectionOutlines[i].chunkIndices.length + sectionOutlines[i + 1].chunkIndices.length
        if (combined < minSize) { minSize = combined; minIdx = i }
      }
      sectionOutlines[minIdx] = {
        title: sectionOutlines[minIdx].title,
        chunkIndices: [...sectionOutlines[minIdx].chunkIndices, ...sectionOutlines[minIdx + 1].chunkIndices],
        startTime: sectionOutlines[minIdx].startTime,
      }
      sectionOutlines.splice(minIdx + 1, 1)
    }
  }

  console.log(`[pack] step 3: ${sectionOutlines.length} sections planned`)

  // Step 4: Batch content generation (multiple sections per API call)
  // Groups of 3 sections per call → e.g., 12 sections = 4 API calls, all parallel
  const sectionGroups = []
  for (let i = 0; i < sectionOutlines.length; i += SECTIONS_PER_CALL) {
    sectionGroups.push(sectionOutlines.slice(i, i + SECTIONS_PER_CALL))
  }
  console.log(`[pack] step 4: ${sectionGroups.length} API calls for ${sectionOutlines.length} sections (${SECTIONS_PER_CALL}/call, ${MAX_PARALLEL_CALLS} parallel)`)

  const sections = []
  for (let wave = 0; wave < sectionGroups.length; wave += MAX_PARALLEL_CALLS) {
    const parallelBatch = sectionGroups.slice(wave, wave + MAX_PARALLEL_CALLS)

    const results = await Promise.allSettled(
      parallelBatch.map(group =>
        generateBatchWithRetry(group, chunks, learningType, language, sectionOutlines.length)
      )
    )

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        sections.push(...results[j].value)
      } else {
        console.error(`[pack] batch ${wave + j} FAILED:`, results[j].reason?.message)
        sections.push(...parallelBatch[j].map(o => makeFallbackSection(o)))
      }
    }

    console.log(`[pack] progress: ${sections.length}/${sectionOutlines.length} sections`)

    // Delay between waves to avoid rate limits
    if (wave + MAX_PARALLEL_CALLS < sectionGroups.length) {
      await new Promise(r => setTimeout(r, 1500))
    }
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
    model: QUALITY_MODEL,
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
    model: FAST_MODEL,
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
    model: FAST_MODEL,
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
