import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── Simple mode prompts (non-study-pack) ────────────────────────────────────

const PROMPTS = {
  'action-steps': `You are a practical assistant.

Extract ONLY concrete, executable actions from this video.

OUTPUT:

GOAL:
- What the user can achieve

STEPS:
- 3–5 specific actions
- Each must be immediately doable
- No generic advice like "learn" or "understand"

MISTAKES TO AVOID:
- Common pitfalls mentioned or implied in the video

Be specific and practical.

Respond ONLY with valid JSON in this exact structure:
{
  "goal": "string",
  "steps": ["string"],
  "mistakes": ["string"]
}`,

  'summary': `Summarize this video in the most concise way possible.

OUTPUT:
- 3–5 bullet points
- Max 1 sentence each

Avoid fluff.
Focus only on key information.

Respond ONLY with valid JSON in this exact structure:
{
  "bullets": ["string"]
}`,

  'key-insights': `Extract the most valuable insights from this video.

OUTPUT:

INSIGHTS:
- 3–5 non-obvious ideas

WHY THEY MATTER:
- Why each insight is useful

Avoid obvious or generic statements.

Respond ONLY with valid JSON in this exact structure:
{
  "insights": [
    {"insight": "string", "why": "string"}
  ]
}`,

  'study-notes': `Turn this video into structured study notes.

OUTPUT:

TOPICS:
- Organized sections from the video

KEY POINTS:
- Bullet points per topic

QUICK REVIEW:
- Short recap of everything covered

Make it clean and structured.

Respond ONLY with valid JSON in this exact structure:
{
  "topics": [
    {"title": "string", "points": ["string"]}
  ],
  "quickReview": "string"
}`,

  'study-pack': `You are a study assistant.

Turn this YouTube transcript into a STUDY PACK.

Do NOT summarize.
Focus on helping the user learn and remember.

---

OUTPUT:

NOTES:
- Organized into topics
- Bullet points

KEY CONCEPTS:
- Important definitions and terms

QUIZ:
- 5 multiple-choice questions
- Include correct answers separately

FLASHCARDS:
- 5–10 Q&A pairs for memorization

---

RULES:

- Be clear and structured
- Focus on learning
- Avoid fluff
- Make quiz questions meaningful
- Flashcards should test understanding, not trivial facts

Respond ONLY with valid JSON in this exact structure:
{
  "notes": [
    {"topic": "string", "points": ["string"]}
  ],
  "keyConcepts": [
    {"term": "string", "definition": "string"}
  ],
  "quiz": [
    {
      "question": "string",
      "options": ["A. string", "B. string", "C. string", "D. string"],
      "answer": "string (e.g. A)"
    }
  ],
  "flashcards": [
    {"question": "string", "answer": "string"}
  ]
}`,

  'decision-help': `Help the user make a decision based on this video.

OUTPUT:

WHAT IS BEING EVALUATED:
- The product, idea, or topic being discussed

PROS:
- Clear benefits

CONS:
- Real downsides

FINAL TAKE:
- When it is worth it and when it is not

Be practical and honest.

Respond ONLY with valid JSON in this exact structure:
{
  "evaluated": "string",
  "pros": ["string"],
  "cons": ["string"],
  "finalTake": "string"
}`,
}

// ─── Per-learning-type practice instructions ──────────────────────────────────

const PRACTICE_INSTRUCTIONS = {
  coding: `PRACTICE — This is a CODING/TECHNICAL video.
For each section that covers a technical concept, generate 2–3 exercises using these types:
- predict_output: put a real code/query snippet in "code", ask what it returns, provide 4 MC options + correct answer letter + explanation
- write_code: ask user to write a function/query from scratch — include referenceAnswer and evaluationRubric checklist
- fix_code: put buggy code in "code" field, ask user to fix it — include referenceAnswer with the corrected version
For intro/non-technical sections set practice to [].
DO NOT generate solve_problem, short_answer, or any non-coding types.`,

  math: `PRACTICE — This is a MATH/PROBLEM-SOLVING video.
For each section that contains solvable problems, generate 2–3 exercises using these types:
- solve_problem: pose a full problem — include referenceAnswer with step-by-step solution and evaluationRubric
- numeric_answer: ask for a specific numeric result — set "answer" to the exact value (e.g. "42" or "1/2")
- explain_steps: ask user to explain how to approach a problem type — include referenceAnswer with key steps
- find_the_mistake: put a worked solution with a deliberate error in "code" field, ask where the mistake is — include referenceAnswer with the explanation
For conceptual/intro sections set practice to [].
DO NOT generate write_code or any programming tasks.`,

  conceptual: `PRACTICE — This is a CONCEPTUAL/THEORY video.
For each section that covers a key idea, generate 2–3 exercises using these types:
- short_answer: ask a focused factual question about the section — include referenceAnswer
- explain_concept: ask user to explain a concept in their own words — include referenceAnswer
- apply_the_idea: describe a real scenario and ask user to apply the concept — include referenceAnswer
For trivial/transitional sections set practice to [].
DO NOT generate write_code, solve_problem, or any coding/math tasks.`,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MULTI-STEP STUDY PACK PIPELINE ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Architecture:
//   Step 1: Chunk transcript into ~1500-char segments with timestamps
//   Step 2: Outline — AI groups chunks into logical sections (topic detection)
//   Step 3: Generate — AI creates full content for each section (parallel)
//   Step 4: Validate — check section count, split bloated sections, merge dupes
//
// This replaces the old single-pass approach where one prompt tried to produce
// the entire study pack at once, causing long videos to collapse into 2-3 sections.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Step 1: Chunk transcript ────────────────────────────────────────────────
// Splits transcript into segments of roughly CHUNK_TARGET_CHARS characters,
// preserving line boundaries. Each chunk records its start/end timestamps
// extracted from the [MM:SS] prefixes in the transcript lines.

const CHUNK_TARGET_CHARS = 1500

function chunkTranscript(transcript) {
  const lines = transcript.split('\n').filter(l => l.trim())
  if (lines.length === 0) return []

  const chunks = []
  let currentLines = []
  let currentLen = 0

  for (const line of lines) {
    currentLines.push(line)
    currentLen += line.length + 1
    if (currentLen >= CHUNK_TARGET_CHARS) {
      chunks.push(buildChunk(currentLines, chunks.length))
      currentLines = []
      currentLen = 0
    }
  }
  if (currentLines.length > 0) {
    chunks.push(buildChunk(currentLines, chunks.length))
  }
  return chunks
}

function buildChunk(lines, index) {
  const text = lines.join('\n')
  const firstTs = extractTimestamp(lines[0])
  const lastTs = extractTimestamp(lines[lines.length - 1])
  return { index, text, startTime: firstTs, endTime: lastTs, charCount: text.length }
}

function extractTimestamp(line) {
  const m = line?.match(/^\[(\d{2}:\d{2})\]/)
  return m ? m[1] : null
}

// ─── Estimate target section count ───────────────────────────────────────────
// Uses transcript length as the primary signal since we often don't have exact
// video duration. The heuristics match the user's desired ranges:
//   <10min → 2-4, 10-30min → 4-8, 30-60min → 6-12,
//   1-2h → 10-20, 2-4h → 16-35, 4h+ → 25+

function estimateSectionRange(transcriptCharCount, chunkCount) {
  // A rough estimate: YouTube captions produce ~800-1200 chars/minute.
  // Use 1000 chars/min as middle ground.
  const estMinutes = transcriptCharCount / 1000

  let min, max
  if (estMinutes < 10)       { min = 2;  max = 4  }
  else if (estMinutes < 30)  { min = 4;  max = 8  }
  else if (estMinutes < 60)  { min = 6;  max = 12 }
  else if (estMinutes < 120) { min = 10; max = 20 }
  else if (estMinutes < 240) { min = 16; max = 35 }
  else                       { min = 25; max = 50 }

  // Never request more sections than we have chunks
  max = Math.min(max, chunkCount)
  min = Math.min(min, max)

  return { min, max, estMinutes: Math.round(estMinutes) }
}

// ─── Step 2: Outline — AI groups chunks into sections ────────────────────────
// Sends the chunk summaries to the model and asks it to group them into
// logical sections based on topic transitions. This is a lightweight call
// (~4k tokens input) that produces just the outline, not the full content.

async function generateOutline(chunks, sectionRange, language) {
  // Build a condensed view: first 200 chars of each chunk + timestamps
  const chunkSummaries = chunks.map((c, i) => {
    const preview = c.text.slice(0, 200).replace(/\n/g, ' ')
    const ts = c.startTime ? `[${c.startTime}]` : ''
    return `Chunk ${i}: ${ts} ${preview}...`
  }).join('\n')

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `You are building a study outline from a video transcript that has been split into ${chunks.length} sequential chunks.

ESTIMATED VIDEO LENGTH: ~${sectionRange.estMinutes} minutes
TARGET SECTION COUNT: ${sectionRange.min}–${sectionRange.max} sections (adapt to actual topic density)

Your job: group these chunks into logical sections. Each section = one coherent topic/concept block.

CHUNK PREVIEWS:
${chunkSummaries}

RULES:
- Each section must list which chunk indices it covers (e.g. [0,1,2])
- Sections must be in order and cover ALL chunks — no gaps, no overlaps
- Section titles must be SPECIFIC to the content (e.g. "SQL JOIN Types and When to Use Them"), never generic ("Part 1", "Introduction", "Main Content")
- Only use "Introduction" if the first few chunks are truly introductory
- If a topic spans many chunks, that's ONE section (don't split mid-concept)
- If a chunk covers a topic shift, start a new section
- Prefer more smaller sections over fewer large ones — each section should be a clear subtopic
- Output language: ${language}

Respond ONLY with valid JSON:
{
  "sections": [
    {
      "title": "string — specific descriptive title",
      "chunkIndices": [0, 1, 2],
      "startTime": "MM:SS or null",
      "summary": "1-sentence description of what this section covers"
    }
  ]
}`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  const data = JSON.parse(response.choices[0].message.content)
  return data.sections || []
}

// ─── Step 3: Generate full content per section ───────────────────────────────
// For each outlined section, sends the FULL chunk text and asks the model to
// produce notes, quiz, flashcards, and practice. Runs in parallel batches.

const SECTION_OUTPUT_SCHEMA = `Respond ONLY with valid JSON:
{
  "title": "string",
  "startTime": "MM:SS",
  "notes": ["string — bullet point"],
  "keyConcepts": [{"term": "string", "definition": "string"}],
  "quiz": [
    {
      "question": "string",
      "options": ["A. string", "B. string", "C. string", "D. string"],
      "answer": "string (letter only, e.g. B)",
      "explanation": "string — why the correct answer is right",
      "questionType": "concept|application|comparison|error_detection|reasoning"
    }
  ],
  "flashcards": [{"question": "string", "answer": "string"}],
  "practice": [
    {
      "type": "string",
      "prompt": "string",
      "code": "string (optional)",
      "options": ["A. string", "B. string", "C. string", "D. string"] ,
      "answer": "string (optional)",
      "explanation": "string (optional)",
      "referenceAnswer": "string (optional)",
      "evaluationRubric": ["string"]
    }
  ]
}`

async function generateSectionContent(outline, chunkTexts, learningType, language, totalSections) {
  const practiceInstr = PRACTICE_INSTRUCTIONS[learningType] || PRACTICE_INSTRUCTIONS.conceptual

  // Scale content amounts based on how many sections there are.
  // With many sections, each section is smaller so fewer items per section.
  // With few sections, each covers more ground so more items per section.
  let notesRange, conceptsRange, quizRange, cardsRange, practiceRange
  if (totalSections <= 4) {
    notesRange = '8–12'; conceptsRange = '5–7'; quizRange = '5–8'; cardsRange = '8–12'; practiceRange = '2–3'
  } else if (totalSections <= 10) {
    notesRange = '5–8'; conceptsRange = '3–5'; quizRange = '5–7'; cardsRange = '5–8'; practiceRange = '1–2'
  } else if (totalSections <= 20) {
    notesRange = '4–6'; conceptsRange = '2–4'; quizRange = '5–6'; cardsRange = '4–6'; practiceRange = '1–2'
  } else {
    notesRange = '3–5'; conceptsRange = '2–3'; quizRange = '5'; cardsRange = '3–5'; practiceRange = '1'
  }

  const prompt = `You are a study assistant generating content for ONE section of a study pack.

SECTION: "${outline.title}"
SECTION SUMMARY: ${outline.summary || 'N/A'}
This is section in a pack with ${totalSections} total sections.

Generate study content from the transcript excerpt below.

PER-SECTION REQUIREMENTS:
- notes: ${notesRange} bullet points covering the key ideas in this section
- keyConcepts: ${conceptsRange} important terms with clear definitions
- quiz: ${quizRange} multiple-choice questions — MINIMUM 5, each with a DIFFERENT questionType
- flashcards: ${cardsRange} Q&A pairs for memorization
- practice: ${practiceRange} exercises

QUIZ RULES — MANDATORY TYPE DISTRIBUTION:
Every section must have at least 5 questions covering these cognitive types:
  [concept] Test understanding of the core idea or definition.
  [application] Apply the concept to a concrete scenario.
  [comparison] Compare or contrast two related ideas.
  [error_detection] Identify a wrong claim or common mistake.
  [reasoning] Edge case, implication, or deeper thinking.
Each question MUST have: questionType, explanation (1-2 sentences), 4 plausible options (A-D).
Do NOT assign the same questionType to two questions unless all 5 types are covered.

${practiceInstr}

RULES:
- Be specific to THIS section's content — no generic filler
- Notes should be learning-focused, not just a transcript summary
- Flashcards should test understanding and application
- Output language: ${language}
- Meet or exceed all minimum counts

${SECTION_OUTPUT_SCHEMA}

TRANSCRIPT EXCERPT:
${chunkTexts}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const section = JSON.parse(response.choices[0].message.content)
  // Ensure the title and startTime from the outline are preserved
  section.title = outline.title
  if (outline.startTime) section.startTime = outline.startTime
  return section
}

// ─── Step 4: Validate sections ───────────────────────────────────────────────
// Checks for common failures: too few sections, bloated sections, generic titles.
// Returns the sections array (possibly modified) and a log of actions taken.

function validateSections(sections, sectionRange, transcriptCharCount) {
  const log = []

  // Check: section count vs expected range
  if (sections.length < sectionRange.min) {
    log.push(`WARNING: only ${sections.length} sections for ~${sectionRange.estMinutes}min video (expected ${sectionRange.min}-${sectionRange.max})`)
  }

  // Check for generic titles
  const genericTitles = ['Introduction', 'Main Content', 'Part 1', 'Part 2', 'Overview', 'Conclusion', 'Summary']
  for (const s of sections) {
    if (genericTitles.some(g => s.title?.toLowerCase().trim() === g.toLowerCase())) {
      log.push(`NOTE: generic title "${s.title}" — consider making it more specific`)
    }
  }

  // Check for near-duplicate adjacent sections (by title similarity)
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1].title?.toLowerCase() || ''
    const curr = sections[i].title?.toLowerCase() || ''
    if (prev === curr || (prev.length > 5 && curr.startsWith(prev.slice(0, Math.floor(prev.length * 0.7))))) {
      log.push(`NOTE: sections ${i} and ${i + 1} have very similar titles: "${sections[i - 1].title}" / "${sections[i].title}"`)
    }
  }

  // Guardrail: absolute minimums for long content
  const minByDuration = getMinSections(sectionRange.estMinutes)
  if (sections.length < minByDuration) {
    log.push(`GUARDRAIL: ${sections.length} sections is below minimum ${minByDuration} for ~${sectionRange.estMinutes}min content`)
  }

  return { sections, log }
}

function getMinSections(estMinutes) {
  if (estMinutes > 240) return 16
  if (estMinutes > 180) return 12
  if (estMinutes > 90)  return 8
  if (estMinutes > 60)  return 6
  if (estMinutes > 30)  return 4
  return 2
}

// ─── Pipeline orchestrator ───────────────────────────────────────────────────
// This is the main entry point for study-pack generation.
// It replaces the old single-pass processTranscript for study-pack mode.

const MAX_PARALLEL = 5  // max concurrent section generation calls

async function generateStudyPack(transcript, learningType, language) {
  const totalChars = transcript.length

  // Step 1: Chunk the transcript
  const chunks = chunkTranscript(transcript)
  console.log(`[pack] chunked transcript: ${chunks.length} chunks, ${totalChars} chars`)

  if (chunks.length === 0) {
    throw new Error('Transcript is empty — cannot generate study pack')
  }

  // Estimate section range
  const sectionRange = estimateSectionRange(totalChars, chunks.length)
  console.log(`[pack] estimated ~${sectionRange.estMinutes}min, targeting ${sectionRange.min}–${sectionRange.max} sections`)

  // Step 2: Generate outline (lightweight call to group chunks into sections)
  const outline = await generateOutline(chunks, sectionRange, language)
  console.log(`[pack] outline: ${outline.length} sections planned`)

  if (!outline.length) {
    throw new Error('Outline generation returned 0 sections')
  }

  // Step 3: Generate content for each section (parallel in batches)
  const sections = []
  for (let i = 0; i < outline.length; i += MAX_PARALLEL) {
    const batch = outline.slice(i, i + MAX_PARALLEL)
    const results = await Promise.all(
      batch.map(sec => {
        // Gather the full text of all chunks assigned to this section
        const indices = sec.chunkIndices || [sec.index || i]
        const sectionText = indices
          .map(idx => chunks[idx]?.text || '')
          .filter(Boolean)
          .join('\n')
        return generateSectionContent(sec, sectionText, learningType, language, outline.length)
      })
    )
    sections.push(...results)
    if (i + MAX_PARALLEL < outline.length) {
      console.log(`[pack] generated ${sections.length}/${outline.length} sections...`)
    }
  }

  console.log(`[pack] all ${sections.length} sections generated`)

  // Step 3b: Quiz validation (same as before — fill missing quiz questions)
  const filledSections = await validateAndFillQuiz(sections, language)

  // Step 4: Validate structure
  const { sections: validatedSections, log } = validateSections(filledSections, sectionRange, totalChars)
  for (const msg of log) console.log(`[pack] ${msg}`)

  return { sections: validatedSections }
}

// ─── Quiz validation (kept from original) ────────────────────────────────────

const MIN_QUIZ_PER_SECTION = 5
const REQUIRED_QUIZ_TYPES = ['concept', 'application', 'comparison', 'error_detection']
const MIN_DISTINCT_TYPES = 3

async function generateExtraQuiz(section, needed, language, targetTypes = []) {
  const existingQuestions = (section.quiz || [])
    .map((q, i) => `${i + 1}. [${q.questionType || 'unknown'}] ${q.question}`)
    .join('\n')

  const context = [
    `Section title: "${section.title}"`,
    section.notes?.length ? `Notes:\n${section.notes.map(n => `- ${n}`).join('\n')}` : '',
    section.keyConcepts?.length
      ? `Key concepts: ${section.keyConcepts.map(c => `${c.term}: ${c.definition}`).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n\n')

  const typeInstr = targetTypes.length > 0
    ? `You MUST generate questions of these specific types (one per type listed): ${targetTypes.join(', ')}.`
    : `Cover different types not already present: application, comparison, error_detection, or reasoning.`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: `Generate exactly ${needed} NEW multiple-choice quiz question(s) for this section.

${context}

ALREADY GENERATED (do NOT repeat or rephrase these):
${existingQuestions || '(none)'}

TYPE REQUIREMENT:
${typeInstr}

questionType options: concept | application | comparison | error_detection | reasoning
For each question:
- Set "questionType" to the appropriate type
- Write a short "explanation" (1–2 sentences) of why the correct answer is right
- 4 distinct plausible options (A–D)
- Correct answer is the letter only (e.g. "B")
- Output language: ${language}

Respond ONLY with valid JSON:
{"quiz": [{"question": "string", "options": ["A. string","B. string","C. string","D. string"], "answer": "string", "explanation": "string", "questionType": "string"}]}`,
    }],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  })

  const result = JSON.parse(response.choices[0].message.content)
  return Array.isArray(result.quiz) ? result.quiz : []
}

function getMissingTypes(quiz) {
  const present = new Set((quiz || []).map(q => q.questionType).filter(Boolean))
  return REQUIRED_QUIZ_TYPES.filter(t => !present.has(t))
}

function dedupeQuiz(existing, incoming) {
  const seen = new Set(existing.map(q => q.question.toLowerCase().trim()))
  return incoming.filter(q => q.question && !seen.has(q.question.toLowerCase().trim()))
}

async function validateAndFillQuiz(sections, language) {
  const filled = [...sections]

  for (let i = 0; i < filled.length; i++) {
    const s = filled[i]

    // Pass A: quantity check
    const current = s.quiz?.length || 0
    if (current < MIN_QUIZ_PER_SECTION) {
      const needed = MIN_QUIZ_PER_SECTION - current
      const missingTypes = getMissingTypes(s.quiz).slice(0, needed)
      console.log(`[quiz] section ${i + 1} "${s.title}": has ${current}, generating ${needed} more`)

      try {
        const extra = await generateExtraQuiz(s, needed, language, missingTypes)
        const fresh = dedupeQuiz(s.quiz || [], extra)
        filled[i] = { ...s, quiz: [...(s.quiz || []), ...fresh] }
      } catch (err) {
        console.warn(`[quiz] fill failed for section ${i + 1}:`, err.message)
      }
    }

    // Pass B: diversity check
    const afterA = filled[i]
    const presentTypes = new Set((afterA.quiz || []).map(q => q.questionType).filter(Boolean))
    const missingTypes = getMissingTypes(afterA.quiz)

    if (presentTypes.size < MIN_DISTINCT_TYPES && missingTypes.length > 0) {
      const needed = Math.min(missingTypes.length, 2)
      try {
        const extra = await generateExtraQuiz(afterA, needed, language, missingTypes.slice(0, needed))
        const fresh = dedupeQuiz(afterA.quiz || [], extra)
        filled[i] = { ...afterA, quiz: [...(afterA.quiz || []), ...fresh] }
      } catch (err) {
        console.warn(`[quiz] diversity fill failed for section ${i + 1}:`, err.message)
      }
    }
  }

  return filled
}

// ─── Answer evaluation ──────────────────────────────────────────────────────

export async function evaluateAnswer({ question, practiceType, expectedAnswer, lessonContext, studentAnswer, language = 'English' }) {
  const systemPrompt = `You are an expert learning coach evaluating a student's answer.

Output language: ${language}. Write all feedback in this language.

Evaluate semantically — accept answers that are conceptually correct even if phrased differently.
Distinguish between correct, partial, and incorrect.
Be supportive and concise. Prefer hints over full solutions.

If the student answer is empty or too vague:
- mark as incorrect
- explain what kind of answer is needed
- provide a small hint, not the full solution

Respond ONLY with valid JSON:
{
  "grade": "correct" | "partial" | "incorrect",
  "score": 0-100,
  "strengths": ["string"],
  "missing": ["string"],
  "misconceptions": ["string"],
  "hint": "string",
  "ideal_answer": "string",
  "should_retry": true | false,
  "mastered": true | false,
  "follow_up_question": "string or null",
  "flashcard": { "front": "string", "back": "string" } | null
}`

  const parts = [
    `Question: ${question}`,
    `Practice type: ${practiceType}`,
    `Expected concept/reference: ${expectedAnswer}`,
  ]
  if (lessonContext) parts.push(`Lesson context: ${lessonContext}`)
  parts.push(`Student answer: ${studentAnswer || '(no answer provided)'}`)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: parts.join('\n') },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  return JSON.parse(response.choices[0].message.content)
}

// ─── Transcript classification ──────────────────────────────────────────────

export async function classifyTranscript(transcript) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: `You are classifying an educational YouTube transcript.

Return the dominant learning type:
- conceptual: theory, explanation, history, psychology, business, non-procedural learning
- coding: programming, SQL, Excel formulas, scripting, technical implementation
- math: solving numeric/symbolic problems, equations, fractions, algebra, calculus, statistics, physics calculations

Rules:
- Pick ONE type that best describes the majority of the content
- coding = writing/reading/understanding code or queries
- math = solving numeric problems with formulas and calculations
- conceptual = everything else (ideas, concepts, soft skills, explanations)

Return ONLY valid JSON:
{
  "learningType": "conceptual",
  "confidence": 8,
  "reason": "..."
}

INPUT:
${transcript.slice(0, 4000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })
  return JSON.parse(response.choices[0].message.content)
}

// ─── Exports ─────────────────────────────────────────────────────────────────

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

// processTranscript: handles all modes.
// For study-pack, delegates to the multi-step pipeline.
// For other modes, uses the simple single-prompt approach.

export async function processTranscript(transcript, mode = 'action-steps', depth = 'standard', learningType = 'conceptual', language = 'English') {
  // Study-pack mode uses the multi-step pipeline
  if (mode === 'study-pack') {
    return generateStudyPack(transcript, learningType, language)
  }

  // All other modes use simple single-prompt
  const languageInstruction = `\n\nOutput language: ${language}. Write ALL content in this language.`
  const basePrompt = PROMPTS[mode] || PROMPTS['action-steps']

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: basePrompt + languageInstruction },
      { role: 'user', content: `INPUT:\n${transcript}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  return JSON.parse(response.choices[0].message.content)
}
