/**
 * Automatic paper edge detection with OpenCV.js.
 *
 *   detectDocumentCorners(source) -> { ok, corners: [TL, TR, BR, BL], confidence, available }
 *
 * source: ImageBitmap | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
 * corners are in the source's own pixel coordinates. When nothing is found
 * (or OpenCV cannot load) the full frame is returned with ok:false.
 */
import { getCv, deleteAll } from './opencv.js'
import { toCanvas, getImageData, sourceSize } from './imageUtils.js'

const WORK_SIZE = 800
const MIN_AREA_RATIO = 0.15

export function fullFrameCorners(width, height) {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
}

/** Order four points as TL, TR, BR, BL. */
export function orderCorners(pts) {
  if (!Array.isArray(pts) || pts.length !== 4) return pts
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const tl = bySum[0]
  const br = bySum[3]
  const rest = pts.filter((p) => p !== tl && p !== br)
  const byDiff = rest.sort((a, b) => a.x - a.y - (b.x - b.y))
  // larger x - y is top-right
  const tr = byDiff[1]
  const bl = byDiff[0]
  return [tl, tr, br, bl]
}

export function polygonArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

function angleScore(c) {
  // 1 when every corner is close to 90 degrees.
  let worst = 0
  for (let i = 0; i < 4; i++) {
    const p = c[(i + 3) % 4]
    const o = c[i]
    const n = c[(i + 1) % 4]
    const v1 = { x: p.x - o.x, y: p.y - o.y }
    const v2 = { x: n.x - o.x, y: n.y - o.y }
    const dot = v1.x * v2.x + v1.y * v2.y
    const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1
    const deg = (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI
    worst = Math.max(worst, Math.abs(90 - deg))
  }
  return Math.max(0, 1 - worst / 45)
}

function largestQuad(cv, edges, frameArea, mats) {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  mats.push(contours, hierarchy)
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  let best = null
  const n = contours.size()
  for (let i = 0; i < n; i++) {
    const contour = contours.get(i)
    const area = cv.contourArea(contour)
    if (area < frameArea * MIN_AREA_RATIO) { contour.delete(); continue }
    const peri = cv.arcLength(contour, true)
    const approx = new cv.Mat()
    cv.approxPolyDP(contour, approx, 0.02 * peri, true)
    let pts = null
    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      pts = []
      for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] })
    } else if (approx.rows > 4 && approx.rows <= 8) {
      // Slightly rounded corners: try a looser approximation.
      const approx2 = new cv.Mat()
      cv.approxPolyDP(contour, approx2, 0.05 * peri, true)
      if (approx2.rows === 4 && cv.isContourConvex(approx2)) {
        pts = []
        for (let k = 0; k < 4; k++) pts.push({ x: approx2.data32S[k * 2], y: approx2.data32S[k * 2 + 1] })
      }
      approx2.delete()
    }
    approx.delete()
    contour.delete()
    if (pts) {
      const quadArea = polygonArea(pts)
      if (quadArea >= frameArea * MIN_AREA_RATIO && (!best || quadArea > best.area)) best = { pts: orderCorners(pts), area: quadArea }
    }
  }
  return best
}

/**
 * Detect the document's four corners.
 * @param {*} source drawable
 * @param {{ cv?: any }} [opts] pass an already loaded cv to skip the await
 */
export async function detectDocumentCorners(source, opts = {}) {
  const { width, height } = sourceSize(source)
  const fallback = { ok: false, corners: fullFrameCorners(width, height), confidence: 0, available: true }
  if (!width || !height) return { ...fallback, available: false, reason: 'empty' }

  const cv = opts.cv || (await getCv())
  if (!cv) return { ...fallback, available: false, reason: 'unavailable' }

  const mats = []
  try {
    const { canvas, scale } = toCanvas(source, WORK_SIZE)
    const imageData = getImageData(canvas)
    const src = cv.matFromImageData(imageData)
    const gray = new cv.Mat()
    const blur = new cv.Mat()
    const edges = new cv.Mat()
    const closed = new cv.Mat()
    mats.push(src, gray, blur, edges, closed)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
    const frameArea = canvas.width * canvas.height

    // Pass 1: Canny edges, closed with a small kernel so paper borders join up.
    cv.Canny(blur, edges, 60, 180)
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    mats.push(kernel)
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel)
    cv.dilate(closed, closed, kernel)
    let best = largestQuad(cv, closed, frameArea, mats)

    // Pass 2: adaptive threshold + morphology close (better on low-contrast paper).
    const thresh = new cv.Mat()
    const closed2 = new cv.Mat()
    const edges2 = new cv.Mat()
    mats.push(thresh, closed2, edges2)
    cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 5)
    const kernel2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
    mats.push(kernel2)
    cv.morphologyEx(thresh, closed2, cv.MORPH_CLOSE, kernel2)
    cv.Canny(closed2, edges2, 50, 150)
    cv.dilate(edges2, edges2, kernel)
    const second = largestQuad(cv, edges2, frameArea, mats)
    if (second && (!best || second.area > best.area * 1.05)) best = second

    if (!best) return { ...fallback, reason: 'not_found' }

    const corners = best.pts.map((p) => ({
      x: Math.max(0, Math.min(width, p.x / scale)),
      y: Math.max(0, Math.min(height, p.y / scale)),
    }))
    const areaRatio = best.area / frameArea
    const confidence = Math.max(0, Math.min(1, 0.35 + areaRatio * 0.4 + angleScore(corners) * 0.35))
    // A quad that hugs the whole frame is not a real detection.
    if (areaRatio > 0.985) return { ...fallback, reason: 'frame' }
    return { ok: true, corners, confidence: +confidence.toFixed(2), available: true }
  } catch {
    return { ...fallback, reason: 'error' }
  } finally {
    deleteAll(mats)
  }
}
