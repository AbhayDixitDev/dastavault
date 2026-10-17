/**
 * Where a photo was taken, like a photo app's "Places".
 *
 *   photoLocation(file) -> { lat, lng, place } | null
 *
 * Reads the GPS position the camera wrote into the photo (EXIF; the camera's
 * location setting must have been on) and names the town with BigDataCloud's
 * free reverse geocoding. Names are remembered on the device per ~1 km, so a
 * place is looked up once. Without internet the position is kept and the
 * place stays unnamed. Nothing here throws.
 */

const CACHE_KEY = 'dv.placeNames'

function cache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
}

function remember(key, name) {
  try {
    const all = cache()
    all[key] = name
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    /* storage full or blocked */
  }
}

/** The GPS position written into a photo, or null. */
export async function gpsOf(file) {
  try {
    if (!file || !/^image\/(jpe?g|heic|heif|tiff|webp|png)/i.test(file.type || '')) return null
    const exifr = await import('exifr/dist/lite.esm.mjs')
    const gps = await (exifr.gps || exifr.default?.gps)(file)
    const lat = Number(gps?.latitude)
    const lng = Number(gps?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 }
  } catch {
    return null
  }
}

/** "Indore, Madhya Pradesh" for a position, or null when it cannot be named now. */
export async function placeName(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`
  const known = cache()[key]
  if (known) return known
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
    const res = await fetch(url)
    if (!res.ok) return null
    const r = await res.json()
    const town = r.city || r.locality || ''
    const region = r.principalSubdivision || r.countryName || ''
    const name = [town, region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
    if (name) remember(key, name)
    return name || null
  } catch {
    return null
  }
}

export async function photoLocation(file) {
  const gps = await gpsOf(file)
  if (!gps) return null
  return { ...gps, place: await placeName(gps.lat, gps.lng) }
}
