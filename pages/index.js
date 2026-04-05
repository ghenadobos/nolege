import { useState, useEffect, useRef, createContext, useContext } from 'react'
import Head from 'next/head'
import { translations } from '../lib/translations'

// ─── Lang context ─────────────────────────────────────────────────────────────

const LangContext = createContext({ T: translations.en, lang: 'en' })
function useLang() { return useContext(LangContext) }

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'yt-study-packs'

function loadPacks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function savePacks(packs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs))
}

// ─── Share helpers ────────────────────────────────────────────────────────────

function encodePackToUrl(data) {
  const json = JSON.stringify(data)
  const encoded = btoa(unescape(encodeURIComponent(json)))
  return `${window.location.origin}${window.location.pathname}#pack=${encoded}`
}

function decodePackFromHash(hash) {
  if (!hash.startsWith('#pack=')) return null
  try {
    return JSON.parse(decodeURIComponent(escape(atob(hash.slice(6)))))
  } catch { return null }
}

function formatPackAsText(data, sourceUrl) {
  const lines = []
  if (sourceUrl) lines.push(`Source: ${sourceUrl}`, '')

  const sections = data.sections || []
  sections.forEach((s, si) => {
    lines.push(`══ ${si + 1}. ${s.title} ══`, '')
    if (s.notes?.length) {
      lines.push('── NOTES ──')
      s.notes.forEach((n) => lines.push(`  • ${n}`))
      lines.push('')
    }
    if (s.keyConcepts?.length) {
      lines.push('── KEY CONCEPTS ──')
      s.keyConcepts.forEach((c) => lines.push(`  ${c.term}: ${c.definition}`))
      lines.push('')
    }
    if (s.quiz?.length) {
      lines.push('── QUIZ ──')
      s.quiz.forEach((q, i) => {
        lines.push(`\n${i + 1}. ${q.question}`)
        q.options?.forEach((o) => lines.push(`   ${o}`))
        lines.push(`   ✓ Answer: ${q.answer}`)
      })
      lines.push('')
    }
    if (s.flashcards?.length) {
      lines.push('── FLASHCARDS ──')
      s.flashcards.forEach((f) => {
        lines.push(`\nQ: ${f.question}`)
        lines.push(`A: ${f.answer}`)
      })
      lines.push('')
    }
  })

  return lines.join('\n')
}

const MODES = [
  { id: 'action-steps', label: 'Action Steps' },
  { id: 'summary', label: 'Summary' },
  { id: 'key-insights', label: 'Key Insights' },
  { id: 'study-notes', label: 'Study Notes' },
  { id: 'study-pack', label: 'Study Pack' },
  { id: 'decision-help', label: 'Decision Help' },
]

function formatDuration(seconds, T) {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}${T.videoH} ${m}${T.videoMin}`
  return `${m} ${T.videoMin}`
}

const EXAMPLE = {
  notes: [
    {
      topic: 'How Memory Works',
      points: [
        'The brain stores information in short-term and long-term memory',
        'Repetition strengthens neural pathways over time',
        'Sleep plays a key role in consolidating new knowledge',
      ],
    },
  ],
  quiz: {
    question: 'What strengthens neural pathways in the brain?',
    options: ['A. Repetition', 'B. Eating more', 'C. Multitasking', 'D. Avoiding sleep'],
    answer: 'A',
  },
  flashcard: {
    question: 'What is the spacing effect?',
    answer: 'Spreading study sessions over time leads to better long-term retention than cramming.',
  },
}

const LOADING_DELAYS = [0, 4000, 18000, 40000, 120000, 240000]

// ─── Loading state ────────────────────────────────────────────────────────────

function LoadingState() {
  const { T } = useLang()
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timers = LOADING_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setStep(i + 1), delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  return (
    <div className="text-center py-16">
      <div className="inline-block w-6 h-6 border-2 border-neutral-900 dark:border-neutral-100 border-t-transparent rounded-full animate-spin mb-5" />
      <p className="text-neutral-700 dark:text-neutral-300 text-sm font-medium">{T.loadingSteps[step]}</p>
      <div className="flex justify-center gap-1.5 mt-5">
        {LOADING_DELAYS.map((_, i) => (
          <div
            key={i}
            className={`h-px rounded-full transition-all duration-500 ${
              i <= step
                ? 'w-8 bg-neutral-900 dark:bg-neutral-100'
                : 'w-3 bg-neutral-300 dark:bg-neutral-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function friendlyError(msg, T) {
  const m = msg.toLowerCase()
  if (m.includes('no transcript') || m.includes('no captions') || m.includes('transcript available'))
    return T.errNoTranscript
  if (m.includes('private') || m.includes('unavailable') || m.includes('not supported') || m.includes('unplayable'))
    return T.errPrivate
  if (m.includes('invalid youtube url') || m.includes('paste a valid'))
    return T.errInvalidUrl
  if (m.includes('download') || m.includes('decipher') || m.includes('audio download'))
    return T.errDownload
  if (m.includes('openai') || m.includes('ai processing'))
    return T.errAi
  return msg
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [theme, setTheme]                   = useState('light')
  const [lang, setLang]                     = useState('en')
  const [url, setUrl]                       = useState('')
  const [videoInfo, setVideoInfo]           = useState(null)
  const [infoLoading, setInfoLoading]       = useState(false)
  const [loading, setLoading]               = useState(false)
  const [result, setResult]                 = useState(null)
  const [transcriptSource, setTranscriptSource] = useState(null)
  const [activeUrl, setActiveUrl]           = useState('')
  const [error, setError]                   = useState(null)
  const [savedPacks, setSavedPacks]         = useState([])
  const [saved, setSaved]                   = useState(false)
  const [copyState, setCopyState]           = useState(null)
  const debounceRef                         = useRef(null)

  const T = translations[lang] || translations.en

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Theme
    const savedTheme = localStorage.getItem('app_theme')
    const preferred  = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    applyTheme(preferred)

    // Language
    const savedLang = localStorage.getItem('app_language') || 'en'
    setLang(savedLang)

    // Persistent user ID
    if (!localStorage.getItem('nolege_uid')) {
      localStorage.setItem('nolege_uid', crypto.randomUUID())
    }

    // Packs
    setSavedPacks(loadPacks())

    // Shared pack from URL hash
    const pack = decodePackFromHash(window.location.hash)
    if (pack) {
      setResult(pack)
      setSaved(false)
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // ── Debounced video info ───────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    setVideoInfo(null)
    if (!url.trim()) return
    debounceRef.current = setTimeout(async () => {
      setInfoLoading(true)
      try {
        const res = await fetch(`/api/video-info?url=${encodeURIComponent(url.trim())}`)
        if (res.ok) {
          const data = await res.json()
          if (data.duration) setVideoInfo(data)
        }
      } catch {}
      setInfoLoading(false)
    }, 800)
    return () => clearTimeout(debounceRef.current)
  }, [url])

  // ── Theme helpers ─────────────────────────────────────────────────────────
  function applyTheme(t) {
    setTheme(t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('app_theme', next)
    applyTheme(next)
  }

  // ── Language helper ───────────────────────────────────────────────────────
  function changeLang(newLang) {
    setLang(newLang)
    localStorage.setItem('app_language', newLang)
  }

  // ── Pack helpers ──────────────────────────────────────────────────────────
  function handleSavePack() {
    const pack = { id: Date.now(), url: activeUrl, data: result, savedAt: new Date().toISOString() }
    const updated = [pack, ...savedPacks]
    setSavedPacks(updated)
    savePacks(updated)
    setSaved(true)
  }

  function handleDeletePack(id) {
    const updated = savedPacks.filter((p) => p.id !== id)
    setSavedPacks(updated)
    savePacks(updated)
  }

  function handleLoadPack(pack) {
    setResult(pack.data)
    setActiveUrl(pack.url)
    setSaved(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleCopyLink() {
    const shareUrl = encodePackToUrl(result)
    if (shareUrl.length > 8000) { handleCopyText(); return }
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyState('link')
      setTimeout(() => setCopyState(null), 2500)
    })
  }

  function handleCopyText() {
    navigator.clipboard.writeText(formatPackAsText(result, activeUrl)).then(() => {
      setCopyState('text')
      setTimeout(() => setCopyState(null), 2500)
    })
  }

  function trackEvent(eventName, metadata = {}) {
    fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:    eventName,
        userId:   localStorage.getItem('nolege_uid'),
        videoUrl: activeUrl || null,
        metadata,
      }),
    }).catch(() => {})
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault()
    setError(null)
    setResult(null)
    setTranscriptSource(null)
    setLoading(true)
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode: 'study-pack', depth: 'full', language: lang }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch {
        setError(`Server returned unexpected response: ${text.slice(0, 200)}`); return
      }
      if (!res.ok) { setError(data.error || 'Something went wrong.') }
      else {
        setResult(data)
        setTranscriptSource(data.transcriptSource || null)
        setActiveUrl(url)
        setSaved(false)
        trackEvent('study_pack_generated', { language: lang })
      }
    } catch (err) {
      setError(`Request failed: ${err?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <LangContext.Provider value={{ T, lang }}>
      <Head>
        <title>Nolege</title>
        <meta name="description" content="Learn from YouTube videos faster. Notes, quiz, and flashcards generated in seconds." />
      </Head>
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-8">

          {/* ── Header ── */}
          <Header theme={theme} onToggleTheme={toggleTheme} lang={lang} onChangeLang={changeLang} />

          {/* ── Hero ── */}
          <section className="pt-16 pb-14 text-center">
            <h1 className="font-display text-5xl font-bold text-neutral-900 dark:text-neutral-100 leading-[1.1] tracking-tight mb-6">
              {T.headline}
            </h1>
            <p className="text-neutral-500 dark:text-neutral-400 text-base mb-12 leading-relaxed">
              {T.subtitle}
              <span className="block text-sm mt-1 text-neutral-400 dark:text-neutral-500">{T.noSignup}</span>
            </p>

            {/* Input */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={T.placeholder}
                className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-xl px-4 py-3.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-neutral-800 dark:focus:border-neutral-300 transition shadow-sm"
                disabled={loading}
              />

              {videoInfo?.duration && (
                <p className="text-xs text-center text-neutral-400 dark:text-neutral-500">
                  {formatDuration(videoInfo.duration, T)} video
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white disabled:bg-neutral-200 dark:disabled:bg-neutral-800 disabled:text-neutral-400 dark:disabled:text-neutral-600 text-white dark:text-neutral-900 text-sm font-semibold py-3.5 rounded-xl transition tracking-wide"
              >
                {loading ? T.generating : T.generate}
              </button>
              <p className="text-center text-xs text-neutral-400 dark:text-neutral-500 mt-2">
                ✦ {T.betaLabel}
              </p>
            </form>
          </section>

          {/* ── Loading ── */}
          {loading && <LoadingState />}

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-4 py-3.5 text-sm mb-8">
              <p className="font-semibold mb-0.5">{T.errTitle}</p>
              <p className="text-red-500 dark:text-red-500">{friendlyError(error, T)}</p>
            </div>
          )}

          {/* ── Result ── */}
          {result && (
            <div className="pb-16">
              {transcriptSource === 'audio' && (
                <div className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>🎙</span>
                  <span>{T.audioGenerated}</span>
                </div>
              )}

              {/* ── Language mismatch banner ── */}
              {result.contentLanguage && result.contentLanguage !== lang && (
                <div className="flex items-start justify-between gap-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 mb-4">
                  <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">{T.langChangedBanner}</p>
                  <button
                    type="button"
                    onClick={() => handleSubmit(null)}
                    disabled={loading}
                    className="shrink-0 text-xs font-semibold bg-amber-700 dark:bg-amber-600 hover:bg-amber-800 dark:hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition whitespace-nowrap"
                  >
                    {T.regenerateCTA}
                  </button>
                </div>
              )}

              <Results data={result} mode="study-pack" onTrack={trackEvent} />
              <FeedbackWidget onTrack={trackEvent} />
              <div className="mt-4 space-y-2">
                {saved ? (
                  <p className="text-center text-sm text-green-600 dark:text-green-400 font-medium">{T.savedPack}</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleSavePack}
                    className="w-full border border-neutral-900 dark:border-neutral-300 text-neutral-900 dark:text-neutral-300 hover:bg-neutral-900 dark:hover:bg-neutral-300 hover:text-white dark:hover:text-neutral-900 text-sm font-medium py-2.5 rounded-xl transition"
                  >
                    {T.savePack}
                  </button>
                )}
                <button type="button" onClick={handleCopyText}
                  className="w-full border border-neutral-300 dark:border-neutral-700 hover:border-neutral-800 dark:hover:border-neutral-300 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm py-2.5 rounded-xl transition">
                  {copyState === 'text' ? T.textCopied : T.copyText}
                </button>
              </div>
            </div>
          )}

          {/* ── Example + Benefits (shown when no result) ── */}
          {!result && !loading && (
            <>
              <ExampleSection />
              <BenefitsSection />
            </>
          )}

          {/* ── My Study Packs ── */}
          {savedPacks.length > 0 && (
            <div className="pb-16">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-500 mb-4">
                {T.myPacks}
              </h2>
              <div className="space-y-2">
                {savedPacks.map((pack) => (
                  <div key={pack.id} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm">
                    <div className="min-w-0">
                      <p className="text-sm text-neutral-900 dark:text-neutral-100 truncate">{pack.url}</p>
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                        {new Date(pack.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => handleLoadPack(pack)}
                        className="text-xs text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-900 dark:hover:border-neutral-300 px-3 py-1.5 rounded-lg transition">
                        {T.open}
                      </button>
                      <button type="button" onClick={() => handleDeletePack(pack.id)}
                        className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-600 dark:hover:text-red-400 border border-neutral-200 dark:border-neutral-700 hover:border-red-300 dark:hover:border-red-700 px-3 py-1.5 rounded-lg transition">
                        {T.delete}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </LangContext.Provider>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ theme, onToggleTheme, lang, onChangeLang }) {
  const { T } = useLang()
  return (
    <div className="flex items-center justify-between py-4 border-b border-neutral-200 dark:border-neutral-800">
      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
        {T.appName}
      </span>
      <div className="flex items-center gap-2">
        {/* Language dropdown */}
        <select
          value={lang}
          onChange={(e) => onChangeLang(e.target.value)}
          className="text-xs border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition"
        >
          <option value="en">English</option>
          <option value="cs">Čeština</option>
        </select>
        {/* Theme toggle */}
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? T.lightMode : T.darkMode}
          className="text-sm border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded-lg px-2.5 py-1.5 hover:border-neutral-400 dark:hover:border-neutral-500 transition select-none"
          aria-label={theme === 'dark' ? T.lightMode : T.darkMode}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </div>
  )
}

// ─── Example section ──────────────────────────────────────────────────────────

function ExampleSection() {
  const { T } = useLang()
  const [cardFlipped, setCardFlipped] = useState(false)
  const [quizAnswered, setQuizAnswered] = useState(null)

  return (
    <section className="pb-16">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-500 text-center mb-8">
        {T.exampleOutput}
      </p>
      <div className="space-y-3">

        {/* Notes preview */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-blue-600 dark:text-blue-400 mb-3">📘 Notes — How Memory Works</p>
          <ul className="space-y-1.5">
            {EXAMPLE.notes[0].points.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-400 dark:text-neutral-500 shrink-0">→</span>{p}
              </li>
            ))}
          </ul>
        </div>

        {/* Quiz preview */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-600 dark:text-amber-400 mb-3">❓ {T.tabQuiz.replace('❓ ', '')}</p>
          <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium mb-3">{EXAMPLE.quiz.question}</p>
          <ul className="space-y-2">
            {EXAMPLE.quiz.options.map((opt, i) => {
              const letter = opt.charAt(0)
              const isCorrect = letter === EXAMPLE.quiz.answer
              const isSelected = quizAnswered === letter
              let cls = 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500'
              if (quizAnswered) {
                if (isCorrect) cls = 'border-green-400 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 font-medium cursor-default'
                else if (isSelected) cls = 'border-red-300 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 cursor-default'
                else cls = 'border-neutral-100 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-default'
              }
              return (
                <li key={i} onClick={() => !quizAnswered && setQuizAnswered(letter)}
                  className={`text-sm px-3 py-2 rounded-lg border transition select-none ${cls}`}>
                  {opt}
                </li>
              )
            })}
          </ul>
        </div>

        {/* Flashcard preview */}
        <div
          onClick={() => setCardFlipped(f => !f)}
          className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 cursor-pointer select-none shadow-sm"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-green-600 dark:text-green-400 mb-3">🔁 {T.tabCards.replace('🔁 ', '')}</p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1">{cardFlipped ? T.exampleAnswer : T.exampleFlashcardHint}</p>
          <p className="text-neutral-900 dark:text-neutral-100 text-sm">{cardFlipped ? EXAMPLE.flashcard.answer : EXAMPLE.flashcard.question}</p>
        </div>

      </div>
    </section>
  )
}

// ─── Benefits section ─────────────────────────────────────────────────────────

function BenefitsSection() {
  const { T } = useLang()
  return (
    <section className="pb-24">
      <div className="grid grid-cols-3 gap-3">
        {T.benefits.map((b) => (
          <div key={b.title} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 text-center shadow-sm">
            <p className="text-2xl mb-3">{b.icon}</p>
            <p className="text-neutral-900 dark:text-neutral-100 text-sm font-semibold mb-1">{b.title}</p>
            <p className="text-neutral-400 dark:text-neutral-500 text-xs leading-relaxed">{b.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ label, color, children }) {
  const colors = {
    blue:   'text-blue-600 dark:text-blue-400',
    green:  'text-green-600 dark:text-green-400',
    red:    'text-red-600 dark:text-red-400',
    purple: 'text-purple-600 dark:text-purple-400',
    yellow: 'text-amber-600 dark:text-amber-400',
    sky:    'text-sky-600 dark:text-sky-400',
    orange: 'text-orange-600 dark:text-orange-400',
  }
  return (
    <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 shadow-sm">
      <h2 className={`text-[11px] font-semibold uppercase tracking-[0.15em] mb-3 ${colors[color] || 'text-neutral-400 dark:text-neutral-500'}`}>
        {label}
      </h2>
      {children}
    </section>
  )
}

function BulletList({ items, color = 'blue' }) {
  const dotColors = {
    green:  'text-green-500 dark:text-green-400',
    purple: 'text-purple-500 dark:text-purple-400',
    red:    'text-red-500 dark:text-red-400',
    blue:   'text-neutral-400 dark:text-neutral-500',
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-neutral-700 dark:text-neutral-300">
          <span className={`shrink-0 ${dotColors[color] || 'text-neutral-400 dark:text-neutral-500'}`}>→</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function NumberedList({ items }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-neutral-700 dark:text-neutral-300">
          <span className="text-green-600 dark:text-green-400 font-bold shrink-0 w-4">{i + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

// ─── Mode result renderers ────────────────────────────────────────────────────

function ActionStepsResult({ data }) {
  const { T } = useLang()
  return (
    <div className="space-y-4">
      {data.goal && (
        <Section label={T.modeLabels['action-steps']} color="blue">
          <p className="text-neutral-700 dark:text-neutral-300 text-sm leading-relaxed">{data.goal}</p>
        </Section>
      )}
      {data.steps?.length > 0 && (
        <Section label="Steps" color="green">
          <NumberedList items={data.steps} />
        </Section>
      )}
      {data.mistakes?.length > 0 && (
        <Section label="Mistakes to Avoid" color="red">
          <BulletList items={data.mistakes} color="red" />
        </Section>
      )}
    </div>
  )
}

function SummaryResult({ data }) {
  const { T } = useLang()
  return (
    <div className="space-y-4">
      {data.bullets?.length > 0 && (
        <Section label={T.modeLabels['summary']} color="sky">
          <BulletList items={data.bullets} color="blue" />
        </Section>
      )}
    </div>
  )
}

function KeyInsightsResult({ data }) {
  return (
    <div className="space-y-4">
      {data.insights?.map((item, i) => (
        <section key={i} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 shadow-sm">
          <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium mb-1">{item.insight}</p>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm leading-relaxed">{item.why}</p>
        </section>
      ))}
    </div>
  )
}

function StudyNotesResult({ data }) {
  return (
    <div className="space-y-4">
      {data.topics?.map((topic, i) => (
        <Section key={i} label={topic.title} color="purple">
          <BulletList items={topic.points} color="purple" />
        </Section>
      ))}
      {data.quickReview && (
        <Section label="Quick Review" color="yellow">
          <p className="text-neutral-700 dark:text-neutral-300 text-sm leading-relaxed">{data.quickReview}</p>
        </Section>
      )}
    </div>
  )
}

function DecisionHelpResult({ data }) {
  return (
    <div className="space-y-4">
      {data.evaluated && (
        <Section label="What's Being Evaluated" color="sky">
          <p className="text-neutral-700 dark:text-neutral-300 text-sm">{data.evaluated}</p>
        </Section>
      )}
      {data.pros?.length > 0 && (
        <Section label="Pros" color="green">
          <BulletList items={data.pros} color="green" />
        </Section>
      )}
      {data.cons?.length > 0 && (
        <Section label="Cons" color="red">
          <BulletList items={data.cons} color="red" />
        </Section>
      )}
      {data.finalTake && (
        <Section label="Final Take" color="yellow">
          <p className="text-neutral-700 dark:text-neutral-300 text-sm leading-relaxed">{data.finalTake}</p>
        </Section>
      )}
    </div>
  )
}

// ─── Study pack result ────────────────────────────────────────────────────────

function StudyPackResult({ data, onTrack }) {
  const { T } = useLang()
  const [expanded, setExpanded] = useState(0)
  const [sectionAnswers, setSectionAnswers] = useState({})

  const sections = data.sections || []

  function answerQuestion(si, qi, letter) {
    setSectionAnswers((prev) => {
      if ((prev[si] || {})[qi] !== undefined) return prev
      return { ...prev, [si]: { ...(prev[si] || {}), [qi]: letter } }
    })
  }

  function resetSection(si) {
    setSectionAnswers((prev) => ({ ...prev, [si]: {} }))
  }

  const totalQ    = sections.reduce((a, s) => a + (s.quiz?.length || 0), 0)
  const answeredQ = Object.values(sectionAnswers).reduce((a, m) => a + Object.keys(m).length, 0)
  const correctQ  = sections.reduce((acc, s, si) =>
    acc + (s.quiz || []).reduce((a, q, qi) =>
      a + ((sectionAnswers[si]?.[qi] === q.answer?.trim().charAt(0).toUpperCase()) ? 1 : 0), 0), 0)

  return (
    <div className="space-y-2">
      {/* Overall progress bar */}
      {answeredQ > 0 && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 mb-4 shadow-sm">
          <div className="flex justify-between text-xs text-neutral-400 dark:text-neutral-500 mb-2">
            <span>Overall quiz progress</span>
            <span>{correctQ} / {totalQ} {T.correct}</span>
          </div>
          <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-1 overflow-hidden">
            <div className="h-1 rounded-full bg-neutral-900 dark:bg-neutral-100 transition-all duration-500"
              style={{ width: `${Math.round((answeredQ / totalQ) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* All sections — always visible */}
      {sections.map((section, si) => (
        <SectionItem
          key={si}
          section={section}
          index={si}
          total={sections.length}
          isOpen={expanded === si}
          onToggle={() => setExpanded((prev) => prev === si ? null : si)}
          answers={sectionAnswers[si] || {}}
          onAnswer={(qi, letter) => answerQuestion(si, qi, letter)}
          onReset={() => resetSection(si)}
          onTrack={onTrack}
        />
      ))}
    </div>
  )
}

// ─── Section item ─────────────────────────────────────────────────────────────

function SectionItem({ section, index, total, isOpen, onToggle, answers, onAnswer, onReset, onTrack }) {
  const { T } = useLang()
  const [tab, setTab] = useState('notes')
  const quizTrackedRef = useRef(false)

  function handleTabChange(tabId) {
    if (tabId === 'quiz' && !quizTrackedRef.current) {
      quizTrackedRef.current = true
      onTrack?.('quiz_started', { sectionTitle: section.title, sectionIndex: index })
    }
    setTab(tabId)
  }

  const quiz     = section.quiz || []
  const practice = section.practice || []
  const answered = Object.keys(answers).length
  const score    = quiz.reduce((acc, q, i) => {
    const correct = q.answer?.trim().charAt(0).toUpperCase()
    return answers[i] === correct ? acc + 1 : acc
  }, 0)
  const percent  = quiz.length > 0 ? Math.round((score / quiz.length) * 100) : 0
  const quizDone = answered === quiz.length && quiz.length > 0

  const tabs = [
    { id: 'notes',    label: T.tabNotes },
    { id: 'quiz',     label: `${T.tabQuiz}${answered > 0 ? ` ${score}/${quiz.length}` : ''}` },
    ...(practice.length > 0 ? [{ id: 'practice', label: T.tabPractice }] : []),
    { id: 'cards',    label: T.tabCards },
  ]

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">{index + 1}/{total}</span>
          <span className="text-neutral-900 dark:text-neutral-100 text-sm font-medium truncate">{section.title}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          {practice.length > 0 && (
            <span className="text-xs text-purple-600 dark:text-purple-400">💻 {practice.length}</span>
          )}
          {answered > 0 && (
            <span className={`text-xs font-medium ${percent >= 80 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {score}/{quiz.length}
            </span>
          )}
          <span className="text-neutral-400 dark:text-neutral-500 text-xs">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Content — always mounted so tab/practice/flashcard state is never lost */}
      <div className={isOpen ? 'border-t border-neutral-200 dark:border-neutral-700' : 'hidden'}>
        {/* Tab bar */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => handleTabChange(t.id)}
              className={`flex-1 py-2.5 text-xs font-medium transition border-b-2 ${
                tab === t.id
                  ? 'border-neutral-900 dark:border-neutral-100 text-neutral-900 dark:text-neutral-100'
                  : 'border-transparent text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* Notes tab */}
          <div className={tab !== 'notes' ? 'hidden' : 'space-y-4'}>

            {/* Screenshot for visual-heavy sections */}
            {section.visualContext?.screenshot?.imageUrl && (() => {
              const shot = section.visualContext.screenshot
              const typeLabel = shot.imageType && !['talking_head', 'irrelevant'].includes(shot.imageType)
                ? shot.imageType.charAt(0).toUpperCase() + shot.imageType.slice(1)
                : null
              return (
                <figure className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.imageUrl}
                    alt={shot.caption || 'Visual screenshot'}
                    className="w-full block object-cover"
                  />
                  <figcaption className="flex items-start gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-100 dark:border-neutral-700">
                    {typeLabel && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 px-1.5 py-0.5 rounded shrink-0 mt-px">{typeLabel}</span>
                    )}
                    {shot.timestamp && (
                      <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 shrink-0 mt-px">{shot.timestamp}</span>
                    )}
                    {shot.caption && (
                      <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">{shot.caption}</p>
                    )}
                  </figcaption>
                </figure>
              )
            })()}

            {section.notes?.length > 0 && (
              <ul className="space-y-1.5">
                {section.notes.map((note, i) => (
                  <li key={i} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <span className="text-neutral-400 dark:text-neutral-500 shrink-0">→</span>{note}
                  </li>
                ))}
              </ul>
            )}
            {section.keyConcepts?.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-400 dark:text-neutral-500 mb-2">{T.keyConcepts}</p>
                {section.keyConcepts.map((c, i) => (
                  <div key={i}>
                    <span className="text-neutral-900 dark:text-neutral-100 text-sm font-medium">{c.term}: </span>
                    <span className="text-neutral-500 dark:text-neutral-400 text-sm">{c.definition}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quiz tab */}
          <div className={tab !== 'quiz' ? 'hidden' : 'space-y-4'}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex-1 mr-4">
                <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-1 overflow-hidden">
                  <div className="h-1 rounded-full transition-all duration-500"
                    style={{ width: `${percent}%`, backgroundColor: percent >= 80 ? '#16a34a' : percent >= 50 ? '#d97706' : '#dc2626' }} />
                </div>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                  {answered} {T.of} {quiz.length} {T.answered} · {score} {T.correct}
                </p>
              </div>
              <button type="button" onClick={onReset}
                className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 px-2.5 py-1 rounded-lg transition">
                {T.reset}
              </button>
            </div>
            {quizDone && (
              <p className={`text-sm font-medium ${percent >= 80 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {percent >= 80 ? T.greatJob : T.keepPracticing}
              </p>
            )}
            {quiz.map((q, qi) => {
              const selected      = answers[qi]
              const isAnswered    = selected !== undefined
              const correctLetter = q.answer?.trim().charAt(0).toUpperCase()
              const isCorrect     = isAnswered && selected === correctLetter
              return (
                <div key={qi}>
                  <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium mb-2">{qi + 1}. {q.question}</p>
                  <ul className="space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const letter = opt.trim().charAt(0).toUpperCase()
                      let cls = 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 cursor-pointer'
                      if (isAnswered) {
                        if (letter === correctLetter) cls = 'border-green-400 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 font-medium cursor-default'
                        else if (letter === selected)  cls = 'border-red-300 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 cursor-default'
                        else                           cls = 'border-neutral-100 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-default'
                      }
                      return (
                        <li key={oi} onClick={() => onAnswer(qi, letter)}
                          className={`text-sm px-3 py-2 rounded-lg border transition select-none ${cls}`}>
                          {opt}
                        </li>
                      )
                    })}
                  </ul>
                  {/* Explanation shown after answering */}
                  {isAnswered && q.explanation && (
                    <p className={`mt-2 text-xs leading-relaxed px-3 py-2 rounded-lg ${
                      isCorrect
                        ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400'
                        : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
                    }`}>
                      {q.explanation}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Practice tab — always mounted to preserve typed answers and eval results */}
          <div className={tab !== 'practice' ? 'hidden' : ''}>
            <PracticePanel exercises={practice} onTrack={onTrack} />
          </div>

          {/* Flashcards tab — always mounted to preserve queue and learned progress */}
          <div className={tab !== 'cards' ? 'hidden' : ''}>
            <FlashcardsPanel cards={section.flashcards || []} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Practice panel ───────────────────────────────────────────────────────────

const EXERCISE_COLORS = {
  predict_output:   'text-purple-600 dark:text-purple-400',
  write_code:       'text-purple-600 dark:text-purple-400',
  fix_code:         'text-orange-600 dark:text-orange-400',
  solve_problem:    'text-blue-600 dark:text-blue-400',
  numeric_answer:   'text-blue-600 dark:text-blue-400',
  explain_steps:    'text-blue-600 dark:text-blue-400',
  find_the_mistake: 'text-orange-600 dark:text-orange-400',
  short_answer:     'text-green-600 dark:text-green-400',
  explain_concept:  'text-green-600 dark:text-green-400',
  apply_the_idea:   'text-green-600 dark:text-green-400',
}

const CODE_EDITOR_TYPES = new Set(['write_code', 'fix_code'])

const GRADE_BORDER = {
  correct:   'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
  partial:   'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900',
  incorrect: 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900',
  error:     'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900',
}

function scoreToMastery(score, grade, T) {
  if (grade === 'correct') return { label: T.masteryGreat,    color: 'text-green-600 dark:text-green-400' }
  if (grade === 'error')   return { label: T.masteryError,    color: 'text-neutral-400 dark:text-neutral-500' }
  const s = score ?? 0
  if (grade === 'incorrect' || s < 30) return { label: T.masteryKeepGoing, color: 'text-orange-600 dark:text-orange-400' }
  if (s >= 80) return { label: T.masteryClose,    color: 'text-amber-600 dark:text-amber-400' }
  if (s >= 55) return { label: T.masteryAlmost,   color: 'text-amber-600 dark:text-amber-400' }
  if (s >= 35) return { label: T.masteryGoodStart,color: 'text-orange-600 dark:text-orange-400' }
  return         { label: T.masteryNeedsMore,      color: 'text-orange-600 dark:text-orange-400' }
}

function getCoachingLine(score, grade, T) {
  if (grade === 'correct' || grade === 'error') return null
  const s = score ?? 0
  if (grade === 'incorrect' || s < 30) return T.coachingIncorrect
  if (s >= 75) return T.coachingHigh
  if (s >= 50) return T.coachingMid
  return T.coachingLow
}

function normalizeAnswer(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ─── Evaluation result ────────────────────────────────────────────────────────

function EvalResult({ result, isCodeEditor, onRetry, onSaveFlashcard, flashcardSaved }) {
  const { T } = useLang()
  const [showIdeal, setShowIdeal] = useState(false)
  const grade    = result.grade || 'error'
  const mastery  = scoreToMastery(result.score, grade, T)
  const coaching = getCoachingLine(result.score, grade, T)
  const divider  = 'border-t border-neutral-100 dark:border-neutral-800'

  return (
    <div className={`rounded-xl border ${GRADE_BORDER[grade] || GRADE_BORDER.error} overflow-hidden`}>

      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <p className={`text-sm font-semibold ${mastery.color}`}>{mastery.label}</p>
          {result.mastered && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">{T.masteredLabel}</span>
          )}
        </div>
        {coaching && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{coaching}</p>
        )}
      </div>

      {/* What you got right */}
      {result.strengths?.filter(Boolean).length > 0 && (
        <div className={`px-4 py-3 ${divider}`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-2">{T.whatGotRight}</p>
          <ul className="space-y-1">
            {result.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                <span className="text-green-500 dark:text-green-400 shrink-0">✓</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* To improve */}
      {result.missing?.filter(Boolean).length > 0 && (
        <div className={`px-4 py-3 ${divider}`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-2">{T.toImprove}</p>
          <ul className="space-y-1">
            {result.missing.map((m, i) => (
              <li key={i} className="flex gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-400 dark:text-neutral-500 shrink-0">→</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Watch out for */}
      {result.misconceptions?.filter(Boolean).length > 0 && (
        <div className={`px-4 py-3 ${divider}`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-2">{T.watchOut}</p>
          <ul className="space-y-1">
            {result.misconceptions.filter(Boolean).map((m, i) => (
              <li key={i} className="flex gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                <span className="text-amber-500 dark:text-amber-400 shrink-0">⚠</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hint */}
      {result.hint && (
        <div className={`px-4 py-3 ${divider}`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-1">{T.hintLabel}</p>
          <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">{result.hint}</p>
        </div>
      )}

      {/* Follow-up */}
      {result.follow_up_question && (
        <div className={`px-4 py-3 ${divider}`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-1">{T.exploreFurther}</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 italic">{result.follow_up_question}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className={`px-4 py-4 ${divider} space-y-2`}>
        {result.should_retry && !result.mastered && (
          <button type="button" onClick={onRetry}
            className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white text-white dark:text-neutral-900 text-sm font-semibold py-2.5 rounded-lg transition">
            {T.tryAgain}
          </button>
        )}
        {result.ideal_answer && (
          <>
            <button type="button" onClick={() => setShowIdeal(v => !v)}
              className="w-full border border-neutral-300 dark:border-neutral-600 hover:border-neutral-500 dark:hover:border-neutral-400 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm py-2.5 rounded-lg transition">
              {showIdeal ? T.hideIdeal : T.showIdeal}
            </button>
            {showIdeal && (
              <pre className={`mt-1 px-3 py-3 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-lg text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed ${isCodeEditor ? 'font-mono' : ''}`}>
                {result.ideal_answer}
              </pre>
            )}
          </>
        )}
      </div>

      {/* Flashcard from mistake */}
      {result.flashcard?.front && (
        <div className={`px-4 py-4 ${divider} bg-neutral-50 dark:bg-neutral-800`}>
          <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-3">{T.fromMistake}</p>
          <div className="space-y-2 mb-3">
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2.5">
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1">{T.frontLabel}</p>
              <p className="text-sm text-neutral-900 dark:text-neutral-100">{result.flashcard.front}</p>
            </div>
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2.5">
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1">{T.backLabel}</p>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{result.flashcard.back}</p>
            </div>
          </div>
          <button type="button"
            onClick={() => !flashcardSaved && onSaveFlashcard(result.flashcard)}
            disabled={flashcardSaved}
            className={`w-full text-sm py-2 rounded-lg border transition font-medium ${
              flashcardSaved
                ? 'border-green-300 dark:border-green-700 text-green-600 dark:text-green-400 cursor-default'
                : 'border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400 hover:border-neutral-900 dark:hover:border-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100'
            }`}>
            {flashcardSaved ? T.savedToCards : T.addToCards}
          </button>
        </div>
      )}
    </div>
  )
}

function PracticePanel({ exercises, onTrack }) {
  const { T, lang } = useLang()
  const [state, setState] = useState({})
  const textareaRefs = useRef({})

  function setEx(i, patch) {
    setState((prev) => ({ ...prev, [i]: { ...(prev[i] || {}), ...patch } }))
  }

  function handleRetry(i) {
    setEx(i, { result: null, retrying: true })
    setTimeout(() => textareaRefs.current[i]?.focus(), 50)
  }

  function handleSaveFlashcard(i) {
    setEx(i, { flashcardSaved: true })
  }

  async function submitForEval(i, exercise) {
    const userAnswer = state[i]?.userAnswer || ''
    if (!userAnswer.trim()) return
    setEx(i, { loading: true, result: null, retrying: false })
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: exercise.prompt,
          code: exercise.code || null,
          referenceAnswer: exercise.referenceAnswer,
          rubric: exercise.evaluationRubric,
          userAnswer,
          exerciseType: exercise.type,
          language: lang,
        }),
      })
      const data = await res.json()
      setEx(i, {
        loading: false,
        result: res.ok ? data : { grade: 'error', hint: data.error || 'Evaluation failed.' },
      })
      if (res.ok) onTrack?.('practice_used', { exerciseType: exercise.type || 'unknown' })
    } catch {
      setEx(i, { loading: false, result: { grade: 'error', hint: 'Request failed. Please try again.' } })
    }
  }

  return (
    <div className="space-y-6">
      {exercises.map((ex, i) => {
        const s           = state[i] || {}
        const labelText   = (T.exerciseLabels || {})[ex.type] || ex.type
        const colorClass  = EXERCISE_COLORS[ex.type] || 'text-neutral-400 dark:text-neutral-500'
        const isCodeEditor = CODE_EDITOR_TYPES.has(ex.type)

        // ── predict_output ────────────────────────────────────────────────
        if (ex.type === 'predict_output') {
          const correctLetter = ex.answer?.trim().charAt(0).toUpperCase()
          const isAnswered    = s.selected !== undefined
          return (
            <div key={i} className="space-y-3">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${colorClass}`}>{labelText}</p>
              <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium">{ex.prompt}</p>
              {ex.code && (
                <pre className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-3 text-sm font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre-wrap">{ex.code}</pre>
              )}
              <ul className="space-y-1.5">
                {(ex.options || []).map((opt, oi) => {
                  const letter = opt.trim().charAt(0).toUpperCase()
                  let cls = 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 cursor-pointer'
                  if (isAnswered) {
                    if (letter === correctLetter) cls = 'border-green-400 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 font-medium cursor-default'
                    else if (letter === s.selected) cls = 'border-red-300 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 cursor-default'
                    else cls = 'border-neutral-100 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-default'
                  }
                  return (
                    <li key={oi} onClick={() => !isAnswered && setEx(i, { selected: letter })}
                      className={`text-sm px-3 py-2 rounded-lg border transition select-none font-mono ${cls}`}>
                      {opt}
                    </li>
                  )
                })}
              </ul>
              {isAnswered && (
                <div className={`rounded-lg px-4 py-3 text-sm border ${
                  s.selected === correctLetter
                    ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                    : 'bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}>
                  <p className="font-medium mb-1">{s.selected === correctLetter ? '✓ Correct' : `✗ Correct answer: ${correctLetter}`}</p>
                  {ex.explanation && <p className="text-xs opacity-70 mt-0.5">{ex.explanation}</p>}
                </div>
              )}
            </div>
          )
        }

        // ── numeric_answer ────────────────────────────────────────────────
        if (ex.type === 'numeric_answer') {
          const checked   = s.checked
          const isCorrect = checked && normalizeAnswer(s.userAnswer) === normalizeAnswer(ex.answer)
          return (
            <div key={i} className="space-y-3">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${colorClass}`}>{labelText}</p>
              <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium">{ex.prompt}</p>
              {ex.code && (
                <pre className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-3 text-sm font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre-wrap">{ex.code}</pre>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={s.userAnswer || ''}
                  onChange={(e) => setEx(i, { userAnswer: e.target.value, checked: false })}
                  placeholder={T.yourAnswer}
                  disabled={checked && isCorrect}
                  className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-neutral-800 dark:focus:border-neutral-300 transition font-mono disabled:opacity-50 shadow-sm"
                  onKeyDown={(e) => e.key === 'Enter' && !checked && setEx(i, { checked: true })}
                />
                <button
                  type="button"
                  onClick={() => setEx(i, { checked: true })}
                  disabled={!(s.userAnswer || '').trim() || (checked && isCorrect)}
                  className="bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white disabled:bg-neutral-200 dark:disabled:bg-neutral-800 disabled:text-neutral-400 dark:disabled:text-neutral-600 text-white dark:text-neutral-900 text-sm font-medium px-4 rounded-lg transition"
                >
                  {T.checkButton}
                </button>
              </div>
              {checked && (
                <div className={`rounded-lg px-4 py-3 text-sm border ${
                  isCorrect
                    ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                    : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                }`}>
                  <p className="font-medium">{isCorrect ? '✓ Correct!' : `✗ Not quite — the answer is: ${ex.answer}`}</p>
                  {ex.explanation && <p className="text-xs opacity-70 mt-1">{ex.explanation}</p>}
                </div>
              )}
            </div>
          )
        }

        // ── open-ended (textarea + AI eval) ───────────────────────────────
        const evalResult = s.result
        return (
          <div key={i} className="space-y-3">
            <p className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${colorClass}`}>{labelText}</p>
            <p className="text-neutral-900 dark:text-neutral-100 text-sm font-medium">{ex.prompt}</p>
            {ex.code && (
              <pre className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-3 text-sm font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre-wrap">{ex.code}</pre>
            )}
            {s.retrying && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{T.retryHint}</p>
            )}
            <textarea
              ref={(el) => { textareaRefs.current[i] = el }}
              value={s.userAnswer || ''}
              onChange={(e) => setEx(i, { userAnswer: e.target.value })}
              placeholder={isCodeEditor ? T.codePlaceholder : T.answerPlaceholder}
              rows={isCodeEditor ? 4 : 3}
              disabled={s.loading}
              className={`w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-neutral-800 dark:focus:border-neutral-300 transition resize-y disabled:opacity-50 shadow-sm ${isCodeEditor ? 'font-mono' : ''}`}
            />
            {!evalResult && (
              <button
                type="button"
                onClick={() => submitForEval(i, ex)}
                disabled={s.loading || !(s.userAnswer || '').trim()}
                className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white disabled:bg-neutral-200 dark:disabled:bg-neutral-800 disabled:text-neutral-400 dark:disabled:text-neutral-600 text-white dark:text-neutral-900 text-sm font-semibold py-2.5 rounded-lg transition"
              >
                {s.loading ? T.checking : T.checkAnswer}
              </button>
            )}
            {evalResult && (
              <EvalResult
                result={evalResult}
                isCodeEditor={isCodeEditor}
                onRetry={() => handleRetry(i)}
                onSaveFlashcard={() => handleSaveFlashcard(i)}
                flashcardSaved={s.flashcardSaved || false}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Flashcards panel ─────────────────────────────────────────────────────────

function FlashcardsPanel({ cards }) {
  const { T } = useLang()
  const total   = cards.length
  const [queue, setQueue]   = useState(() => cards.map((c, i) => ({ ...c, key: i })))
  const [known, setKnown]   = useState(0)
  const [flipped, setFlipped] = useState(false)

  const current   = queue[0] || null
  const remaining = queue.length
  const percent   = total > 0 ? Math.round((known / total) * 100) : 0
  const done      = known === total && total > 0

  function markKnown() {
    setKnown((k) => k + 1)
    setQueue((q) => q.slice(1))
    setFlipped(false)
  }

  function markLearning() {
    setQueue((q) => [...q.slice(1), q[0]])
    setFlipped(false)
  }

  function reset() {
    setQueue(cards.map((c, i) => ({ ...c, key: i })))
    setKnown(0)
    setFlipped(false)
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            {T.learned}: <span className="text-neutral-900 dark:text-neutral-100 font-semibold">{known} / {total}</span>
          </span>
          <button type="button" onClick={reset}
            className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 px-3 py-1 rounded-lg transition">
            {T.reset}
          </button>
        </div>
        <div className="w-full bg-neutral-100 dark:bg-neutral-800 rounded-full h-1 overflow-hidden">
          <div className="h-1 rounded-full transition-all duration-500 bg-neutral-900 dark:bg-neutral-100"
            style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500">{T.remaining(remaining)}</p>
      </div>

      {/* Done state */}
      {done && (
        <div className="bg-white dark:bg-neutral-900 border border-green-200 dark:border-green-800 rounded-xl p-8 text-center shadow-sm">
          <p className="text-2xl mb-2">🎉</p>
          <p className="text-neutral-900 dark:text-neutral-100 font-semibold mb-1">{T.allLearned}</p>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-4">{T.allLearnedDesc}</p>
          <button type="button" onClick={reset}
            className="text-sm border border-neutral-300 dark:border-neutral-600 hover:border-neutral-900 dark:hover:border-neutral-300 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 px-5 py-2 rounded-lg transition">
            {T.practiceAgain}
          </button>
        </div>
      )}

      {/* Current card */}
      {!done && current && (
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden shadow-sm">
          <div className="p-6 cursor-pointer select-none" onClick={() => !flipped && setFlipped(true)}>
            <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-3">{T.questionLabel}</p>
            <p className="text-neutral-900 dark:text-neutral-100 text-sm leading-relaxed">{current.question}</p>
            {!flipped && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-4">{T.tapReveal}</p>
            )}
          </div>

          {flipped && (
            <>
              <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 p-6">
                <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.15em] mb-3">{T.answerLabel}</p>
                <p className="text-green-700 dark:text-green-400 text-sm leading-relaxed">{current.answer}</p>
              </div>
              <div className="grid grid-cols-2 border-t border-neutral-100 dark:border-neutral-800">
                <button type="button" onClick={markLearning}
                  className="py-3.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950 border-r border-neutral-100 dark:border-neutral-800 transition font-medium">
                  {T.stillLearning}
                </button>
                <button type="button" onClick={markKnown}
                  className="py-3.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950 transition font-medium">
                  {T.iKnowThis}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Upcoming cards */}
      {!done && queue.length > 1 && (
        <div className="space-y-1">
          {queue.slice(1, 4).map((card, i) => (
            <div key={card.key}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 opacity-30"
              style={{ transform: `scale(${0.98 - i * 0.01})` }}>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{card.question}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Results router ───────────────────────────────────────────────────────────

function Results({ data, mode, onTrack }) {
  const { T } = useLang()
  const modeLabel = T.modeLabels[mode]
  return (
    <div>
      {modeLabel && (
        <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-[0.2em] mb-4">{modeLabel}</p>
      )}
      {mode === 'action-steps'  && <ActionStepsResult data={data} />}
      {mode === 'summary'       && <SummaryResult data={data} />}
      {mode === 'key-insights'  && <KeyInsightsResult data={data} />}
      {mode === 'study-notes'   && <StudyNotesResult data={data} />}
      {mode === 'study-pack'    && <StudyPackResult data={data} onTrack={onTrack} />}
      {mode === 'decision-help' && <DecisionHelpResult data={data} />}
    </div>
  )
}

// ─── Feedback widget ──────────────────────────────────────────────────────────

function FeedbackWidget({ onTrack }) {
  const { T } = useLang()
  const [step, setStep]       = useState('prompt')   // 'prompt' | 'followup-yes' | 'followup-no' | 'done'
  const [vote, setVote]       = useState(null)
  const [liked, setLiked]     = useState('')
  const [better, setBetter]   = useState('')
  const [missing, setMissing] = useState('')
  const [tags, setTags]       = useState([])
  const [sending, setSending] = useState(false)

  function handleVote(v) {
    setVote(v)
    setStep(v === 'yes' ? 'followup-yes' : 'followup-no')
    onTrack('feedback_vote', { vote: v })
  }

  function toggleTag(tag) {
    setTags((prev) => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  async function handleSend() {
    setSending(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'feedback_detail', vote, liked, better, missing, tags }),
      })
      const textSummary = vote === 'yes' ? (liked || better) : missing
      onTrack?.('feedback_submitted', { useful: vote === 'yes', text: textSummary || null, tags })
    } catch {}
    setSending(false)
    setStep('done')
  }

  const textareaClass = 'w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-neutral-600 dark:focus:border-neutral-400 resize-none transition'
  const labelClass    = 'text-xs font-medium text-neutral-500 dark:text-neutral-400 block mb-1.5'

  if (step === 'done') {
    return (
      <div className="mt-6 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-5 py-4 text-center">
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{T.feedbackThanks}</p>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{T.feedbackThanksDesc}</p>
      </div>
    )
  }

  if (step === 'followup-yes') {
    return (
      <div className="mt-6 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-5 py-5 space-y-4">
        <div>
          <label className={labelClass}>{T.feedbackLikedLabel}</label>
          <textarea
            value={liked}
            onChange={(e) => setLiked(e.target.value)}
            placeholder={T.feedbackLikedPlaceholder}
            rows={2}
            className={textareaClass}
          />
        </div>
        <div>
          <label className={labelClass}>{T.feedbackBetterLabel}</label>
          <textarea
            value={better}
            onChange={(e) => setBetter(e.target.value)}
            placeholder={T.feedbackBetterPlaceholder}
            rows={2}
            className={textareaClass}
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white disabled:opacity-50 text-white dark:text-neutral-900 text-sm font-semibold py-2.5 rounded-xl transition"
        >
          {sending ? T.feedbackSending : T.feedbackSend}
        </button>
      </div>
    )
  }

  if (step === 'followup-no') {
    const canSubmit = missing.trim().length > 0
    return (
      <div className="mt-6 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-5 py-5 space-y-4">
        <div>
          <label className={labelClass}>
            {T.feedbackMissingLabel}
            <span className="text-red-400 ml-1">*</span>
          </label>
          <textarea
            value={missing}
            onChange={(e) => setMissing(e.target.value)}
            placeholder={T.feedbackMissingPlaceholder}
            rows={3}
            className={textareaClass}
          />
        </div>
        <div>
          <p className={labelClass}>What went wrong? <span className="font-normal text-neutral-400 dark:text-neutral-500">(optional)</span></p>
          <div className="flex flex-wrap gap-2">
            {T.feedbackCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => toggleTag(cat)}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  tags.includes(cat)
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100'
                    : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600 hover:border-neutral-500 dark:hover:border-neutral-400'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !canSubmit}
          className="w-full bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-white dark:text-neutral-900 text-sm font-semibold py-2.5 rounded-xl transition"
        >
          {sending ? T.feedbackSending : T.feedbackSend}
        </button>
      </div>
    )
  }

  // step === 'prompt'
  return (
    <div className="mt-6 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
      <p className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">{T.feedbackTitle}</p>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleVote('yes')}
          className="text-sm px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 hover:border-green-500 dark:hover:border-green-400 hover:text-green-600 dark:hover:text-green-400 text-neutral-700 dark:text-neutral-300 rounded-lg transition"
        >
          {T.feedbackYes}
        </button>
        <button
          type="button"
          onClick={() => handleVote('no')}
          className="text-sm px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 hover:border-red-400 dark:hover:border-red-500 hover:text-red-500 dark:hover:text-red-400 text-neutral-700 dark:text-neutral-300 rounded-lg transition"
        >
          {T.feedbackNo}
        </button>
      </div>
    </div>
  )
}
