import { evaluateAnswer } from '../../utils/openai'

// Maps exercise types to the three practice categories the evaluator understands
function toPracticeType(exerciseType) {
  if (['write_code', 'fix_code', 'find_the_mistake'].includes(exerciseType)) return 'solve'
  if (['numeric_answer', 'solve_problem'].includes(exerciseType)) return 'calculate'
  return 'explain'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { prompt, code, referenceAnswer, rubric, userAnswer, exerciseType, language = 'en' } = req.body
  const languageName = language === 'cs' ? 'Czech' : 'English'

  if (!prompt || !referenceAnswer || typeof userAnswer !== 'string') {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  if (!userAnswer.trim()) {
    return res.status(400).json({ error: 'Please write an answer before submitting.' })
  }

  const lessonContext = [
    code   ? `Code shown:\n${code}` : '',
    rubric?.length ? `Evaluation criteria:\n${rubric.map(r => `- ${r}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || null

  try {
    const result = await evaluateAnswer({
      question: prompt,
      practiceType: toPracticeType(exerciseType),
      expectedAnswer: referenceAnswer,
      lessonContext,
      studentAnswer: userAnswer,
      language: languageName,
    })
    return res.status(200).json(result)
  } catch (err) {
    console.error('Evaluate error:', err?.message)
    return res.status(500).json({ error: `Evaluation failed: ${err?.message || 'unknown error'}` })
  }
}
