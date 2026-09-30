/**
 * Voice search on top of the browser Speech Recognition API.
 * Works in Chrome, Edge and Safari; resolves { ok: false } elsewhere.
 */

const OCR_TO_SPEECH = {
  eng: 'en-IN',
  hin: 'hi-IN',
  mar: 'mr-IN',
  guj: 'gu-IN',
  ben: 'bn-IN',
  tam: 'ta-IN',
  tel: 'te-IN',
  kan: 'kn-IN',
  mal: 'ml-IN',
  pan: 'pa-IN',
  urd: 'ur-IN',
  fra: 'fr-FR',
  deu: 'de-DE',
  spa: 'es-ES',
  ara: 'ar-SA',
}

function Recognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function isVoiceSupported() {
  return Boolean(Recognition())
}

/**
 * Picks the speech language for a workspace: the first OCR language mapped to
 * a speech locale, otherwise 'en-IN'.
 */
export function voiceLangFor(workspace) {
  const first = Array.isArray(workspace?.ocr_languages) ? workspace.ocr_languages[0] : null
  if (typeof first === 'string') {
    const key = first.toLowerCase().slice(0, 3)
    if (OCR_TO_SPEECH[key]) return OCR_TO_SPEECH[key]
  }
  return 'en-IN'
}

function friendlyError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in your browser settings.'
    case 'no-speech':
      return 'Nothing was heard. Try again and speak clearly.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Voice search needs an internet connection.'
    case 'aborted':
      return 'Listening stopped.'
    default:
      return 'Voice search did not work. Try typing instead.'
  }
}

/**
 * Starts listening and keeps reporting interim text.
 * Returns a handle: { stop(), promise } where promise -> { ok, transcript, error? }.
 */
export function startListening({ lang = 'en-IN', onInterim, onStart } = {}) {
  const R = Recognition()
  if (!R) {
    return {
      stop() {},
      promise: Promise.resolve({ ok: false, transcript: '', error: 'Voice search is not available in this browser.', unsupported: true }),
    }
  }
  const rec = new R()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  let finalText = ''
  let settled = false
  let resolveFn

  const promise = new Promise((resolve) => {
    resolveFn = resolve
  })

  const finish = (result) => {
    if (settled) return
    settled = true
    resolveFn(result)
  }

  rec.onstart = () => onStart?.()
  rec.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      const text = r[0]?.transcript ?? ''
      if (r.isFinal) finalText += text
      else interim += text
    }
    onInterim?.((finalText + ' ' + interim).replace(/\s+/g, ' ').trim())
  }
  rec.onerror = (event) => {
    const code = event?.error
    if (code === 'aborted' && finalText) return
    finish({ ok: false, transcript: finalText.trim(), error: friendlyError(code), code })
  }
  rec.onend = () => {
    const transcript = finalText.trim()
    finish(transcript ? { ok: true, transcript } : { ok: false, transcript: '', error: friendlyError('no-speech'), code: 'no-speech' })
  }

  try {
    rec.start()
  } catch {
    finish({ ok: false, transcript: '', error: friendlyError() })
  }

  return {
    stop() {
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    },
    promise,
  }
}

/** One-shot helper: listens until the person pauses, then resolves the text. */
export function listenOnce(opts = {}) {
  return startListening(opts).promise
}
