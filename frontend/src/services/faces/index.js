/**
 * Faces on this device: finds faces in photos and ID cards and turns each
 * into a "fingerprint" (128 numbers) that is close for the same person.
 *
 *   findFaces(blobOrCanvas) -> [{ box, crop, d }]
 *     box:  { x, y, w, h } as parts of the picture (0..1)
 *     crop: small JPEG of the face (data URL), for showing it
 *     d:    fingerprint (array of 128 numbers, 3 decimals)
 *   matchPerson(d, people) -> { person, distance } | null
 *   faceDistance(a, b)
 *
 * Models: SSD MobileNet v1 (finding faces), 68-point landmarks (lining the
 * face up), ResNet face recognition (the fingerprint). They ship with the app (scripts/copy-ocr.mjs -> public/models/face)
 * and load the first time a face is looked for. Nothing here throws.
 */

const MODEL_URL = `${import.meta.env.BASE_URL || '/'}models/face`
const MAX_SIDE = 1024
const CROP_SIZE = 88

/** Fingerprints closer than this belong to the same person. */
export const SAME_PERSON = 0.5

let loading = null

async function api() {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api')
      try {
        await faceapi.tf.setBackend('webgl')
      } catch {
        await faceapi.tf.setBackend('cpu')
      }
      await faceapi.tf.ready()
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
      return faceapi
    })()
    loading.catch(() => { loading = null })
  }
  return loading
}

/** Starts loading the face models in the background. */
export function warmUpFaces() {
  api().catch(() => {})
}

async function toCanvas(source) {
  let drawable = source
  let close = null
  if (source instanceof Blob) {
    drawable = await createImageBitmap(source, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(source))
    close = () => drawable.close?.()
  }
  const w = drawable.width || drawable.naturalWidth
  const h = drawable.height || drawable.naturalHeight
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height)
  close?.()
  return canvas
}

function cropOf(canvas, box) {
  // A little room around the face, square.
  const side = Math.max(box.width, box.height) * 1.5
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const out = document.createElement('canvas')
  out.width = CROP_SIZE
  out.height = CROP_SIZE
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ddd'
  ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE)
  ctx.drawImage(canvas, cx - side / 2, cy - side / 2, side, side, 0, 0, CROP_SIZE, CROP_SIZE)
  return out.toDataURL('image/jpeg', 0.75)
}

/** Faces in a picture (Blob, image or canvas), biggest first. [] when none or on failure. */
export async function findFaces(source, { minScore = 0.5 } = {}) {
  try {
    const faceapi = await api()
    const canvas = await toCanvas(source)
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: minScore, maxResults: 10 })
    const found = await faceapi.detectAllFaces(canvas, options).withFaceLandmarks().withFaceDescriptors()
    return found
      .map((f) => {
        const b = f.detection.box
        return {
          box: { x: b.x / canvas.width, y: b.y / canvas.height, w: b.width / canvas.width, h: b.height / canvas.height },
          crop: cropOf(canvas, b),
          d: Array.from(f.descriptor, (v) => Math.round(v * 1000) / 1000),
          score: Math.round(f.detection.score * 100) / 100,
        }
      })
      // Tiny faces (a crowd in the background) are not worth naming.
      .filter((f) => f.box.w * canvas.width >= 28)
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  } catch {
    return []
  }
}

export function faceDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/** Fingerprints saved for a person (their photo, faces confirmed in documents). */
export function personFaces(person) {
  const faces = person?.custom?.faces
  return Array.isArray(faces) ? faces.filter((f) => Array.isArray(f) && f.length === 128) : []
}

/** The person whose face is closest to `d`, if close enough. */
export function matchPerson(d, people = []) {
  let best = null
  for (const person of people) {
    for (const known of personFaces(person)) {
      const distance = faceDistance(d, known)
      if (distance < SAME_PERSON && (!best || distance < best.distance)) best = { person, distance }
    }
  }
  return best
}

/**
 * The person's `custom` with a new photo and/or fingerprint added
 * (at most 8 fingerprints are kept: the newest ones).
 */
export function withFace(person, { crop, d } = {}) {
  const custom = { ...(person?.custom || {}) }
  if (crop) custom.photo = crop
  if (d) custom.faces = [...personFaces(person), d].slice(-8)
  return custom
}

/** Groups faces (with a `d`) whose fingerprints are close. Biggest group first. */
export function groupFaces(faces) {
  const groups = []
  for (const face of faces) {
    let best = null
    for (const g of groups) {
      const distance = faceDistance(face.d, g.center)
      if (distance < SAME_PERSON && (!best || distance < best.distance)) best = { g, distance }
    }
    if (best) {
      best.g.faces.push(face)
    } else {
      groups.push({ center: face.d, faces: [face] })
    }
  }
  return groups.sort((a, b) => b.faces.length - a.faces.length)
}

/**
 * Who is on a photo, and which documents show the same face.
 * -> { people: [{ person, crop }], docs: [document] } (best match first)
 */
export async function searchFaces(file, { people = [], docs = [] } = {}) {
  const faces = await findFaces(file, { minScore: 0.4 })
  if (!faces.length) return { people: [], docs: [] }
  const found = []
  for (const face of faces.slice(0, 3)) {
    const match = matchPerson(face.d, people)
    if (match && !found.some((f) => f.person.id === match.person.id)) found.push({ person: match.person, crop: face.crop })
  }
  const scored = []
  for (const doc of docs) {
    let best = Infinity
    for (const docFace of doc.faces || []) {
      for (const face of faces.slice(0, 3)) best = Math.min(best, faceDistance(face.d, docFace.d))
    }
    const ofPerson = found.some((f) => (doc.people || []).some((p) => p.id === f.person.id))
    if (best < SAME_PERSON || ofPerson) scored.push({ doc, score: best < SAME_PERSON ? best : SAME_PERSON })
  }
  scored.sort((a, b) => a.score - b.score)
  return { people: found, docs: scored.map((s) => s.doc), faceCrop: faces[0].crop }
}
