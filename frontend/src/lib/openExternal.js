/**
 * Opens an address outside the app: https links (e.g. WhatsApp) through
 * Android's "open with" (the app that handles them), mailto: in the mail app.
 */
export function openExternal(url) {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  const plugin = cap?.isNativePlatform?.() ? cap.Plugins?.AppUpdater : null
  if (plugin?.openInBrowser && url.startsWith('https://')) {
    plugin.openInBrowser({ url }).catch(() => window.open(url, '_system'))
    return
  }
  if (url.startsWith('mailto:')) {
    window.location.href = url
    return
  }
  window.open(url, '_blank', 'noopener')
}

/**
 * A phone number as WhatsApp wants it: digits with the country code.
 * 10 digits are taken as an Indian mobile number (+91).
 */
export function whatsappNumber(input, defaultCountry = '91') {
  const digits = String(input || '').replace(/\D/g, '').replace(/^00/, '')
  if (digits.length === 10) return `${defaultCountry}${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `${defaultCountry}${digits.slice(1)}`
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}
