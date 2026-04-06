export const translations = {
  en: {
    // ── Header ──────────────────────────────────────────────────────────────
    appName: 'Nolege',
    langLabel: 'EN',
    lightMode: 'Light',
    darkMode: 'Dark',

    // ── Hero ────────────────────────────────────────────────────────────────
    headline: 'Learn from YouTube videos faster',
    subtitle: 'Notes, quiz, and flashcards — generated in seconds.',
    noSignup: 'No signup required.',
    placeholder: 'Paste a YouTube link...',
    generate: 'Generate Study Pack',
    generating: 'Generating...',

    // ── Video info ───────────────────────────────────────────────────────────
    videoMin: 'min',
    videoH: 'h',
    videoLabel: (dur) => `${dur} video`,

    // ── Banners ──────────────────────────────────────────────────────────────
    audioGenerated: 'Transcript auto-generated from audio — accuracy may vary',
    visualEnhanced: 'Enhanced with visual analysis',

    // ── Save / copy ───────────────────────────────────────────────────────────
    savePack: 'Save Study Pack',
    savedPack: '✓ Saved to My Study Packs',
    copyLink: 'Copy share link',
    copyText: 'Copy as text',
    linkCopied: '✓ Link copied!',
    textCopied: '✓ Text copied!',

    // ── Saved packs ───────────────────────────────────────────────────────────
    myPacks: 'My Study Packs',
    open: 'Open',
    delete: 'Delete',

    // ── Example section ───────────────────────────────────────────────────────
    exampleOutput: 'Example output',
    exampleFlashcardHint: 'Question — tap to reveal',
    exampleAnswer: 'Answer',

    // ── Benefits ─────────────────────────────────────────────────────────────
    benefits: [
      { icon: '📘', title: 'Study faster',   desc: 'Turn a 2-hour lecture into structured notes in seconds.' },
      { icon: '❓', title: 'Test yourself',  desc: 'Auto-generated quizzes that actually challenge you.' },
      { icon: '🔁', title: 'Remember more', desc: 'Flashcards designed for spaced repetition practice.' },
    ],

    // ── Section tabs ──────────────────────────────────────────────────────────
    tabNotes: '📘 Notes',
    tabQuiz: '❓ Quiz',
    tabPractice: '💻 Practice',
    tabCards: '🔁 Cards',
    notes: 'Notes',
    keyConcepts: 'Key Concepts',
    visualContext: '✦ Visual context',

    // ── Quiz ─────────────────────────────────────────────────────────────────
    of: 'of',
    answered: 'answered',
    correct: 'correct',
    reset: 'Reset',
    greatJob: '🎉 Great job!',
    keepPracticing: '📚 Keep practicing',

    // ── Flashcards ────────────────────────────────────────────────────────────
    learned: 'Learned',
    remaining: (n) => `${n} card${n !== 1 ? 's' : ''} remaining`,
    allLearned: 'All cards learned!',
    allLearnedDesc: 'Great work. Reset to practice again.',
    practiceAgain: 'Practice Again',
    questionLabel: 'Question',
    answerLabel: 'Answer',
    tapReveal: 'Tap to reveal answer →',
    stillLearning: 'Still learning',
    iKnowThis: 'I know this ✓',

    // ── Locked / paywall ──────────────────────────────────────────────────────
    sectionLabel: 'Section',
    continueLearning: 'Continue learning this topic:',
    lockedSections: (n) => `${n} remaining section${n !== 1 ? 's' : ''}`,
    lockedQuiz: (n) => `${n} quiz question${n !== 1 ? 's' : ''}`,
    lockedCards: (n) => `${n} flashcard${n !== 1 ? 's' : ''}`,
    lockedPractice: 'Practice exercises',
    unlockCTA: 'Unlock full study pack – €1.99',
    oneTime: 'One-time payment • No subscription',

    // ── Practice exercises ────────────────────────────────────────────────────
    exerciseLabels: {
      predict_output:   'Predict the output',
      write_code:       'Write the code',
      fix_code:         'Fix the code',
      solve_problem:    'Solve the problem',
      numeric_answer:   'Calculate the answer',
      explain_steps:    'Explain the steps',
      find_the_mistake: 'Find the mistake',
      short_answer:     'Short answer',
      explain_concept:  'Explain in your own words',
      apply_the_idea:   'Apply the idea',
    },
    checkAnswer: 'Check my answer',
    checking: 'Checking...',
    tryAgain: 'Try again',
    retryHint: 'Revise your answer using the hint above.',
    answerPlaceholder: 'Write your answer here...',
    codePlaceholder: 'Write your code here...',
    checkButton: 'Check',
    yourAnswer: 'Your answer...',

    // ── Eval result ────────────────────────────────────────────────────────────
    showIdeal: 'Show ideal answer',
    hideIdeal: 'Hide ideal answer',
    addToCards: 'Add to cards',
    savedToCards: '✓ Saved to cards',
    fromMistake: 'Created from your mistake',
    frontLabel: 'Front',
    backLabel: 'Back',
    whatGotRight: 'What you got right',
    toImprove: 'To improve your answer',
    watchOut: 'Watch out for',
    hintLabel: 'Hint',
    exploreFurther: 'Explore further',
    masteredLabel: '✦ Mastered',

    // ── Mastery language ──────────────────────────────────────────────────────
    masteryGreat: 'Great answer',
    masteryError: 'Something went wrong',
    masteryKeepGoing: 'Keep going',
    masteryClose: "You're close",
    masteryAlmost: 'Almost there',
    masteryGoodStart: 'Good start',
    masteryNeedsMore: 'Needs one more step',

    // ── Coaching lines ────────────────────────────────────────────────────────
    coachingIncorrect: 'Read the hint below and give it another shot.',
    coachingHigh: "You're close — refine one key idea and try again.",
    coachingMid: 'Good thinking. Use the hint to strengthen your answer.',
    coachingLow: "You're on the right track. Use the hint to fill in the gaps.",

    // ── Loading steps ─────────────────────────────────────────────────────────
    loadingSteps: [
      'Checking for captions...',
      'Extracting transcript...',
      'No captions found — generating transcript from audio...',
      'Transcribing audio (this may take a few minutes)...',
      'Creating study pack...',
      'Almost done...',
    ],

    // ── Errors ────────────────────────────────────────────────────────────────
    errTitle: 'Something went wrong',
    errNoTranscript: 'Could not extract transcript automatically.',
    errPrivate: 'This video is not supported. Try a public video.',
    errInvalidUrl: 'Invalid YouTube URL. Please paste a valid video link.',
    errDownload: 'Could not download audio from this video. It may be restricted or age-gated.',
    errAi: 'AI processing failed. Please try again in a moment.',

    // ── Manual paste fallback ────────────────────────────────────────────────
    pastePrompt: 'You can paste the transcript manually:',
    pasteInstructions: 'Open the video on YouTube, click "..." below the video, select "Show transcript", copy all text, and paste it here.',
    pasteTextarea: 'Paste transcript here...',
    pasteSubmit: 'Generate with pasted transcript',

    // ── Mode labels ───────────────────────────────────────────────────────────
    modeLabels: {
      'action-steps':  'Action Steps',
      'summary':       'Summary',
      'key-insights':  'Key Insights',
      'study-notes':   'Study Notes',
      'study-pack':    'Study Pack',
      'decision-help': 'Decision Help',
    },

    // ── Language mismatch banner ──────────────────────────────────────────────
    langChangedBanner: 'Language changed. Regenerate the study pack to update the content language.',
    regenerateCTA: 'Regenerate in English',

    // ── AI language name ──────────────────────────────────────────────────────
    aiLanguage: 'English',

    // ── Beta label ────────────────────────────────────────────────────────────
    betaLabel: 'Free during beta',

    // ── Feedback widget ───────────────────────────────────────────────────────
    feedbackTitle: 'Was this useful?',
    feedbackYes: 'Yes',
    feedbackNo: 'No',
    feedbackLikedLabel: 'What did you like most?',
    feedbackLikedPlaceholder: 'What worked well for you?',
    feedbackBetterLabel: 'What would make this even better?',
    feedbackBetterPlaceholder: 'Any suggestions?',
    feedbackMissingLabel: 'What was missing or wrong?',
    feedbackMissingPlaceholder: 'Tell us what didn\'t work...',
    feedbackCategories: ['Too shallow', 'Not accurate', 'Bad quiz', 'Bad practice', 'Missing visuals', 'Confusing structure', 'Other'],
    feedbackSend: 'Submit feedback',
    feedbackSending: 'Submitting...',
    feedbackThanks: 'Thanks for the feedback.',
    feedbackThanksDesc: 'It helps us improve Nolege.',
  },

  cs: {
    // ── Header ──────────────────────────────────────────────────────────────
    appName: 'Nolege',
    langLabel: 'CS',
    lightMode: 'Světlý',
    darkMode: 'Tmavý',

    // ── Hero ────────────────────────────────────────────────────────────────
    headline: 'Učte se z YouTube videí rychleji',
    subtitle: 'Poznámky, kvíz a kartičky — vygenerované během sekund.',
    noSignup: 'Bez registrace.',
    placeholder: 'Vložte odkaz na YouTube...',
    generate: 'Vytvořit studijní balíček',
    generating: 'Generuji...',

    // ── Video info ───────────────────────────────────────────────────────────
    videoMin: 'min',
    videoH: 'h',
    videoLabel: (dur) => `${dur} video`,

    // ── Banners ──────────────────────────────────────────────────────────────
    audioGenerated: 'Přepis automaticky generován z audia — přesnost se může lišit',
    visualEnhanced: 'Rozšířeno o vizuální analýzu',

    // ── Save / copy ───────────────────────────────────────────────────────────
    savePack: 'Uložit studijní balíček',
    savedPack: '✓ Uloženo v Moje balíčky',
    copyLink: 'Kopírovat odkaz',
    copyText: 'Kopírovat text',
    linkCopied: '✓ Odkaz zkopírován!',
    textCopied: '✓ Text zkopírován!',

    // ── Saved packs ───────────────────────────────────────────────────────────
    myPacks: 'Moje studijní balíčky',
    open: 'Otevřít',
    delete: 'Smazat',

    // ── Example section ───────────────────────────────────────────────────────
    exampleOutput: 'Ukázkový výstup',
    exampleFlashcardHint: 'Otázka — klepněte pro odpověď',
    exampleAnswer: 'Odpověď',

    // ── Benefits ─────────────────────────────────────────────────────────────
    benefits: [
      { icon: '📘', title: 'Studujte rychleji',  desc: 'Přeměňte dvouhodinovou přednášku na strukturované poznámky během sekund.' },
      { icon: '❓', title: 'Testujte se',         desc: 'Automaticky generované kvízy, které vás skutečně prověří.' },
      { icon: '🔁', title: 'Zapamatujte si více', desc: 'Kartičky navržené pro opakování s rozloženými intervaly.' },
    ],

    // ── Section tabs ──────────────────────────────────────────────────────────
    tabNotes: '📘 Poznámky',
    tabQuiz: '❓ Kvíz',
    tabPractice: '💻 Procvičení',
    tabCards: '🔁 Kartičky',
    notes: 'Poznámky',
    keyConcepts: 'Klíčové pojmy',
    visualContext: '✦ Vizuální kontext',

    // ── Quiz ─────────────────────────────────────────────────────────────────
    of: 'z',
    answered: 'zodpovězeno',
    correct: 'správně',
    reset: 'Resetovat',
    greatJob: '🎉 Výborně!',
    keepPracticing: '📚 Pokračujte v procvičování',

    // ── Flashcards ────────────────────────────────────────────────────────────
    learned: 'Naučeno',
    remaining: (n) => `${n} kartičk${n === 1 ? 'a' : 'y'} zbývá`,
    allLearned: 'Všechny kartičky zvládnuty!',
    allLearnedDesc: 'Skvělá práce. Resetujte a procvičujte znovu.',
    practiceAgain: 'Procvičit znovu',
    questionLabel: 'Otázka',
    answerLabel: 'Odpověď',
    tapReveal: 'Klepněte pro zobrazení odpovědi →',
    stillLearning: 'Stále se učím',
    iKnowThis: 'Umím to ✓',

    // ── Locked / paywall ──────────────────────────────────────────────────────
    sectionLabel: 'Sekce',
    continueLearning: 'Pokračujte ve studiu tohoto tématu:',
    lockedSections: (n) => `${n} zbývající sekce`,
    lockedQuiz: (n) => `${n} otázek v kvízu`,
    lockedCards: (n) => `${n} kartiček`,
    lockedPractice: 'Cvičení',
    unlockCTA: 'Odemknout celý balíček – €1,99',
    oneTime: 'Jednorázová platba • Bez předplatného',

    // ── Practice exercises ────────────────────────────────────────────────────
    exerciseLabels: {
      predict_output:   'Předpovězte výstup',
      write_code:       'Napište kód',
      fix_code:         'Opravte kód',
      solve_problem:    'Vyřešte úlohu',
      numeric_answer:   'Vypočítejte odpověď',
      explain_steps:    'Vysvětlete postup',
      find_the_mistake: 'Najděte chybu',
      short_answer:     'Krátká odpověď',
      explain_concept:  'Vysvětlete vlastními slovy',
      apply_the_idea:   'Aplikujte myšlenku',
    },
    checkAnswer: 'Zkontrolovat odpověď',
    checking: 'Kontroluji...',
    tryAgain: 'Zkusit znovu',
    retryHint: 'Upravte svou odpověď podle nápovědy výše.',
    answerPlaceholder: 'Napište svou odpověď...',
    codePlaceholder: 'Napište kód...',
    checkButton: 'Zkontrolovat',
    yourAnswer: 'Vaše odpověď...',

    // ── Eval result ────────────────────────────────────────────────────────────
    showIdeal: 'Zobrazit vzorovou odpověď',
    hideIdeal: 'Skrýt vzorovou odpověď',
    addToCards: 'Přidat do kartiček',
    savedToCards: '✓ Přidáno do kartiček',
    fromMistake: 'Vytvořeno z vaší chyby',
    frontLabel: 'Přední strana',
    backLabel: 'Zadní strana',
    whatGotRight: 'Co máte správně',
    toImprove: 'Co zlepšit',
    watchOut: 'Dejte pozor na',
    hintLabel: 'Nápověda',
    exploreFurther: 'Prozkoumejte více',
    masteredLabel: '✦ Zvládnuto',

    // ── Mastery language ──────────────────────────────────────────────────────
    masteryGreat: 'Výborná odpověď',
    masteryError: 'Něco se pokazilo',
    masteryKeepGoing: 'Nevzdávejte se',
    masteryClose: 'Skoro to máte',
    masteryAlmost: 'Téměř správně',
    masteryGoodStart: 'Dobrý začátek',
    masteryNeedsMore: 'Ještě jeden krok',

    // ── Coaching lines ────────────────────────────────────────────────────────
    coachingIncorrect: 'Přečtěte si nápovědu níže a zkuste to znovu.',
    coachingHigh: 'Skoro to máte — upřesněte jednu klíčovou myšlenku a zkuste znovu.',
    coachingMid: 'Dobré uvažování. Použijte nápovědu k posílení odpovědi.',
    coachingLow: 'Jste na správné cestě. Vyplňte mezery pomocí nápovědy.',

    // ── Loading steps ─────────────────────────────────────────────────────────
    loadingSteps: [
      'Kontroluji titulky...',
      'Extrahuji přepis...',
      'Titulky nenalezeny — generuji přepis z audia...',
      'Přepisuji audio (může trvat několik minut)...',
      'Vytvářím studijní balíček...',
      'Téměř hotovo...',
    ],

    // ── Errors ────────────────────────────────────────────────────────────────
    errTitle: 'Něco se pokazilo',
    errNoTranscript: 'Přepis nelze extrahovat automaticky.',
    errPrivate: 'Toto video není podporováno. Zkuste veřejné video.',
    errInvalidUrl: 'Neplatný odkaz YouTube. Vložte prosím platný odkaz na video.',
    errDownload: 'Nelze stáhnout audio z tohoto videa. Může být omezeno nebo vyžadovat věkové ověření.',
    errAi: 'Zpracování AI selhalo. Zkuste to prosím za chvíli.',

    // ── Manual paste fallback ────────────────────────────────────────────────
    pastePrompt: 'Můžete vložit přepis ručně:',
    pasteInstructions: 'Otevřete video na YouTube, klikněte na "..." pod videem, vyberte "Zobrazit přepis", zkopírujte text a vložte ho sem.',
    pasteTextarea: 'Vložte přepis sem...',
    pasteSubmit: 'Generovat s vloženým přepisem',

    // ── Mode labels ───────────────────────────────────────────────────────────
    modeLabels: {
      'action-steps':  'Akční kroky',
      'summary':       'Shrnutí',
      'key-insights':  'Klíčové poznatky',
      'study-notes':   'Studijní poznámky',
      'study-pack':    'Studijní balíček',
      'decision-help': 'Pomoc s rozhodnutím',
    },

    // ── Language mismatch banner ──────────────────────────────────────────────
    langChangedBanner: 'Jazyk byl změněn. Regenerujte studijní balíček pro aktualizaci obsahu.',
    regenerateCTA: 'Regenerovat v češtině',

    // ── AI language name ──────────────────────────────────────────────────────
    aiLanguage: 'Czech',

    // ── Beta label ────────────────────────────────────────────────────────────
    betaLabel: 'Zdarma během beta verze',

    // ── Feedback widget ───────────────────────────────────────────────────────
    feedbackTitle: 'Bylo to užitečné?',
    feedbackYes: 'Ano',
    feedbackNo: 'Ne',
    feedbackLikedLabel: 'Co se vám líbilo nejvíc?',
    feedbackLikedPlaceholder: 'Co fungovalo dobře?',
    feedbackBetterLabel: 'Co by to udělalo ještě lepší?',
    feedbackBetterPlaceholder: 'Máte návrhy?',
    feedbackMissingLabel: 'Co chybělo nebo bylo špatně?',
    feedbackMissingPlaceholder: 'Řekněte nám, co nefungovalo...',
    feedbackCategories: ['Příliš povrchní', 'Nepřesné', 'Špatný kvíz', 'Špatné procvičení', 'Chybějící vizuály', 'Matoucí struktura', 'Jiné'],
    feedbackSend: 'Odeslat zpětnou vazbu',
    feedbackSending: 'Odesílám...',
    feedbackThanks: 'Díky za zpětnou vazbu.',
    feedbackThanksDesc: 'Pomáhá nám zlepšovat Nolege.',
  },
}
