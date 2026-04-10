import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

// ─── Study pack depth prompts ─────────────────────────────────────────────────

const SECTION_SCHEMA = `
Respond ONLY with valid JSON in this exact structure:
{
  "sections": [
    {
      "title": "string",
      "startTime": "MM:SS (read from the transcript timestamps — approximate start of this section)",
      "notes": ["string"],
      "keyConcepts": [{"term": "string", "definition": "string"}],
      "quiz": [{"question": "string", "options": ["A. string","B. string","C. string","D. string"], "answer": "string", "explanation": "string", "questionType": "concept|application|comparison|error_detection|reasoning"}],
      "flashcards": [{"question": "string", "answer": "string"}],
      "practice": [
        {
          "type": "string",
          "prompt": "string",
          "code": "string (optional — include for predict_output, fix_code, find_the_mistake)",
          "options": ["A. string", "B. string", "C. string", "D. string"] "(optional — only for predict_output)",
          "answer": "string (optional — exact value for predict_output / numeric_answer)",
          "explanation": "string (optional — shown after answer is revealed)",
          "referenceAnswer": "string (optional — model answer for open-ended types)",
          "evaluationRubric": ["string"] "(optional — checklist for AI evaluator)"
        }
      ]
    }
  ]
}`

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

const MIN_QUIZ_PER_SECTION = 5

function buildPackPrompt(depth, learningType) {
  const practiceInstr = PRACTICE_INSTRUCTIONS[learningType] || PRACTICE_INSTRUCTIONS.conceptual

  const config = {
    quick:    { sections: '2–3', notes: '5–7',  concepts: '3–4', quiz: '5–7',   cards: '6–8',   practice: '0–2' },
    standard: { sections: '4–6', notes: '7–10', concepts: '4–5', quiz: '5–8',   cards: '9–12',  practice: '2–3' },
    full:     { sections: '6–12', notes: '8–12', concepts: '5–7', quiz: '5–10',  cards: '10–15', practice: '3–4' },
  }
  const c = config[depth] || config.standard

  const rules = {
    quick:    'Be concise, each section self-contained. Cover beginning, middle, and end of the video.',
    standard: 'Organize by natural topic boundaries. Quiz varies in difficulty. Cover the full video.',
    full:     'Mirror the actual video structure. Every major topic = its own section. Easy/medium/hard quiz. Cover everything.',
  }

  return `You are a study assistant. Split this video into ${c.sections} logical sections.

PER SECTION:
- title: short descriptive name
- notes: ${c.notes} bullet points — MINIMUM ${c.notes.split('–')[0]}, no exceptions
- keyConcepts: ${c.concepts} terms with definitions
- quiz: see QUIZ RULES below — MINIMUM ${MIN_QUIZ_PER_SECTION}, aim for ${c.quiz}
- flashcards: ${c.cards} Q&A pairs — MINIMUM ${c.cards.split('–')[0]}, no exceptions
- practice: ${c.practice} exercises

QUIZ RULES — MANDATORY TYPE DISTRIBUTION:
Every section must have at least ${MIN_QUIZ_PER_SECTION} questions using these REQUIRED cognitive types:

  [concept]         Test understanding of the core idea or definition.
                    e.g. "Which of these best describes X?" / "What is the purpose of Y?"

  [application]     Apply the concept to a concrete situation or scenario.
                    e.g. "Given X, what would happen?" / "How would you use Y to solve Z?"

  [comparison]      Compare or contrast two related ideas or approaches.
                    e.g. "What is the key difference between A and B?" / "Which approach is correct for X?"

  [error_detection] Identify wrong reasoning, a false claim, or a common mistake.
                    e.g. "Which statement about X is INCORRECT?" / "A student claims Y — what is wrong?"

  [reasoning]       Deeper thinking: edge case, implication, or why something works or fails.
                    e.g. "Why does X NOT work in situation Y?" / "What would break if Z changed?"

For each quiz question you MUST:
- Set "questionType" to one of: concept | application | comparison | error_detection | reasoning
- NEVER assign the same questionType to two questions unless all 5 types are already covered
- Write a short "explanation" (1–2 sentences) saying why the correct answer is right — this helps the learner
- Include 4 distinct plausible options (A–D) — distractors must be believable, not obviously wrong
- Do NOT rephrase the same idea twice across questions in the same section

${practiceInstr}

RULES:
- ${rules[depth] || rules.standard}
- Flashcards should aid memorization and application
- STRICTLY meet or exceed the minimum count for every field — do not produce fewer items regardless of section length or output language
${SECTION_SCHEMA}`
}

// ─── Second-pass quiz fill ────────────────────────────────────────────────────
// Called after the main generation if any section has fewer than MIN_QUIZ_PER_SECTION questions.

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
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Generate exactly ${needed} NEW multiple-choice quiz question(s) for this section.

${context}

ALREADY GENERATED (do NOT repeat or rephrase these):
${existingQuestions || '(none)'}

TYPE REQUIREMENT:
${typeInstr}

questionType options: concept | application | comparison | error_detection | reasoning
- concept: test understanding of the core idea
- application: apply concept to a real situation
- comparison: compare or contrast two ideas
- error_detection: identify a wrong claim or mistake
- reasoning: edge case or deeper implication

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

  try {
    const result = JSON.parse(response.choices[0].message.content)
    return Array.isArray(result.quiz) ? result.quiz : []
  } catch { return [] }
}

// Types that every section should cover at least once
const REQUIRED_QUIZ_TYPES = ['concept', 'application', 'comparison', 'error_detection']
const MIN_DISTINCT_TYPES   = 3   // need at least 3 different types even if not all 4

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

    // ── Pass A: quantity check ────────────────────────────────────────────────
    const current = s.quiz?.length || 0
    if (current < MIN_QUIZ_PER_SECTION) {
      const needed = MIN_QUIZ_PER_SECTION - current
      const missingTypes = getMissingTypes(s.quiz).slice(0, needed)  // target missing types first
      console.log(`[quiz] section ${i + 1} "${s.title}": has ${current} questions, generating ${needed} more (targeting: ${missingTypes.join(', ') || 'any'})`)

      try {
        const extra = await generateExtraQuiz(s, needed, language, missingTypes)
        const fresh = dedupeQuiz(s.quiz || [], extra)
        filled[i] = { ...s, quiz: [...(s.quiz || []), ...fresh] }
        console.log(`[quiz] section ${i + 1}: now ${filled[i].quiz.length} questions`)
      } catch (err) {
        console.warn(`[quiz] quantity pass failed for section ${i + 1}:`, err.message)
      }
    }

    // ── Pass B: diversity check ───────────────────────────────────────────────
    const afterA = filled[i]
    const presentTypes = new Set((afterA.quiz || []).map(q => q.questionType).filter(Boolean))
    const missingTypes  = getMissingTypes(afterA.quiz)

    if (presentTypes.size < MIN_DISTINCT_TYPES && missingTypes.length > 0) {
      const needed = Math.min(missingTypes.length, 2)  // add up to 2 diversity questions
      console.log(`[quiz] section ${i + 1}: only ${presentTypes.size} distinct types, adding ${needed} for: ${missingTypes.slice(0, needed).join(', ')}`)

      try {
        const extra = await generateExtraQuiz(afterA, needed, language, missingTypes.slice(0, needed))
        const fresh = dedupeQuiz(afterA.quiz || [], extra)
        filled[i] = { ...afterA, quiz: [...(afterA.quiz || []), ...fresh] }
        console.log(`[quiz] section ${i + 1}: diversity → ${new Set(filled[i].quiz.map(q => q.questionType).filter(Boolean)).size} types`)
      } catch (err) {
        console.warn(`[quiz] diversity pass failed for section ${i + 1}:`, err.message)
      }
    }
  }

  return filled
}

// ─── Answer evaluation ────────────────────────────────────────────────────────

export async function evaluateAnswer({ question, practiceType, expectedAnswer, lessonContext, studentAnswer, language = 'English' }) {
  const systemPrompt = `You are an expert learning coach evaluating a student's answer.

Output language: ${language}. Write all feedback, hints, strengths, missing points, misconceptions, ideal answer, and follow-up question in this language.

Your role is not only to mark answers right or wrong.
Your role is to help the student learn through targeted feedback.

Evaluate semantically — accept answers that are conceptually correct even if phrased differently.
Distinguish between correct, partial, and incorrect.
Be supportive and concise. Prefer hints over full solutions.
Recommend retry when the answer shows partial understanding or fixable mistakes.
Mark as mastered only when understanding is sufficient.

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
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: parts.join('\n') },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  return JSON.parse(response.choices[0].message.content)
}

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

// ─── Transcript classification ────────────────────────────────────────────────

export async function classifyTranscript(transcript) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
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

export async function processTranscript(transcript, mode = 'action-steps', depth = 'standard', learningType = 'conceptual', language = 'English') {
  const languageInstruction = `\n\nOutput language: ${language}. Write ALL content — notes, key concepts, quiz questions, quiz options, flashcard questions and answers, practice prompts, reference answers, and explanations — in this language.\n\nCRITICAL — CONTENT DEPTH: The amount of content, depth, and level of detail must be IDENTICAL regardless of language. Do NOT produce fewer bullet points, fewer quiz questions, or fewer flashcards because the language is not English. Shorter words in one language do not mean fewer items — always hit the minimum counts specified above.`

  const basePrompt = mode === 'study-pack'
    ? buildPackPrompt(depth, learningType)
    : (PROMPTS[mode] || PROMPTS['action-steps'])

  const systemPrompt = basePrompt + languageInstruction

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `INPUT:\n${transcript}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const raw = response.choices[0].message.content
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    console.error('[openai] JSON parse failed:', err.message, 'raw:', (raw || '').slice(0, 300))
    throw new Error('AI returned invalid response')
  }

  // Validate and fill quiz for study-pack mode — second pass (skip if time is tight)
  if (mode === 'study-pack' && Array.isArray(data.sections)) {
    try {
      data.sections = await validateAndFillQuiz(data.sections, language)
    } catch (err) {
      console.warn('[quiz-fill] skipped:', err.message)
    }
  }

  return data
}
