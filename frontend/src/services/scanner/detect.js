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
const MIN_AREA_RATIO = 0.08

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

function medianOf(mat) {
  const hist = new Array(256).fill(0)
  const data = mat.data
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++
  const half = data.length / 8
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= half) return v
  }
  return 128
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

function pointsOf(mat) {
  const pts = []
  for (let k = 0; k < mat.rows; k++) pts.push({ x: mat.data32S[k * 2], y: mat.data32S[k * 2 + 1] })
  return pts
}

/**
 * Four corners for a contour. Paper with rounded or slightly covered corners
 * does not simplify to exactly four points, so its convex hull is simplified
 * with a growing tolerance; failing that, the smallest rotated rectangle
 * around it is used.
 */
function quadOf(cv, contour) {
  const hull = new cv.Mat()
  cv.convexHull(contour, hull, false, true)
  const peri = cv.arcLength(hull, true)
  let pts = null
  for (const eps of [0.015, 0.02, 0.03, 0.045, 0.06, 0.08]) {
    const approx = new cv.Mat()
    cv.approxPolyDP(hull, approx, eps * peri, true)
    const rows = approx.rows
    if (rows === 4) pts = pointsOf(approx)
    approx.delete()
    if (pts || rows < 4) break
  }
  let fitted = false
  if (!pts) {
    const rect = cv.minAreaRect(hull)
    const box = cv.RotatedRect.points(rect)
    pts = box.map((p) => ({ x: p.x, y: p.y }))
    fitted = true
  }
  hull.delete()
  return { pts: orderCorners(pts), fitted }
}

/**
 * The quadrilateral in `edges` that most looks like a sheet of paper: large,
 * with corners near 90 degrees, not just the edge of the picture.
 */
function bestQuad(cv, edges, frame, mats) {
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  mats.push(contours, hierarchy)
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  const frameArea = frame.width * frame.height
  const margin = Math.max(frame.width, frame.height) * 0.01
  const found = []
  const n = contours.size()
  for (let i = 0; i < n; i++) {
    const contour = contours.get(i)
    const contourArea = cv.contourArea(contour)
    if (contourArea < frameArea * MIN_AREA_RATIO) { contour.delete(); continue }
    const { pts, fitted } = quadOf(cv, contour)
    contour.delete()
    const area = polygonArea(pts)
    const ratio = area / frameArea
    if (ratio < MIN_AREA_RATIO || ratio > 0.985) continue
    // How much of the quad the contour fills: low for random clutter.
    const solidity = Math.min(1, contourArea / area)
    const square = angleScore(pts)
    const onBorder = pts.filter((p) => p.x <= margin || p.y <= margin || p.x >= frame.width - margin || p.y >= frame.height - margin).length
    const score = Math.sqrt(ratio) * (0.4 + 0.6 * square) * (0.5 + 0.5 * solidity) * (fitted ? 0.8 : 1) * (onBorder >= 3 ? 0.6 : 1)
    found.push({ pts, area, score })
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 3)
}

/**
 * Sharpens the corners: fits a straight line to the edge pixels along the
 * middle of each side and puts every corner where two lines meet. A corner
 * hidden under a finger or rounded off is rebuilt from the visible sides.
 */
function refineCorners(edges, pts, frame) {
  const { cols, rows, data } = edges
  const lines = []
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 20) return pts
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    const xs = []
    const ys = []
    // The middle 70% of the side; a covered corner sits at an end.
    for (let t = 0.15; t <= 0.85; t += 2 / len) {
      const cx = a.x + (b.x - a.x) * t
      const cy = a.y + (b.y - a.y) * t
      let bestD = null
      for (let d = -8; d <= 8; d++) {
        const x = Math.round(cx + nx * d)
        const y = Math.round(cy + ny * d)
        if (x < 0 || y < 0 || x >= cols || y >= rows || !data[y * cols + x]) continue
        if (bestD === null || Math.abs(d) < Math.abs(bestD)) bestD = d
      }
      if (bestD !== null) {
        xs.push(cx + nx * bestD)
        ys.push(cy + ny * bestD)
      }
    }
    if (xs.length < len * 0.25) return pts
    // Least squares line through the points (principal direction).
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length
    const my = ys.reduce((s, v) => s + v, 0) / ys.length
    let sxx = 0
    let sxy = 0
    let syy = 0
    for (let k = 0; k < xs.length; k++) {
      const dx = xs[k] - mx
      const dy = ys[k] - my
      sxx += dx * dx
      sxy += dx * dy
      syy += dy * dy
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    lines.push({ x: mx, y: my, dx: Math.cos(angle), dy: Math.sin(angle) })
  }
  const out = []
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4]
    const l2 = lines[i]
    const det = l1.dx * l2.dy - l1.dy * l2.dx
    if (Math.abs(det) < 1e-6) return pts
    const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / det
    out.push({ x: l1.x + l1.dx * t, y: l1.y + l1.dy * t })
  }
  // Only small moves: a big jump means the lines were fitted to something else.
  const diag = Math.hypot(frame.width, frame.height)
  const ok = out.every((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y) < diag * 0.08 && p.x > -diag * 0.02 && p.y > -diag * 0.02 && p.x < frame.width + diag * 0.02 && p.y < frame.height + diag * 0.02)
  return ok && angleScore(out) >= angleScore(pts) - 0.1 ? out : pts
}

/** Share of the quad's outline that runs along an edge in `edges` (0..1). */
function edgeSupport(edges, pts) {
  const { cols, rows, data } = edges
  let hit = 0
  let total = 0
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    const steps = Math.max(8, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 4))
    for (let k = 1; k < steps; k++) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / steps)
      const y = Math.round(a.y + ((b.y - a.y) * k) / steps)
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue
      total++
      if (data[y * cols + x]) hit++
    }
  }
  return total ? hit / total : 0
}

/**
 * How much the inside of `pts` looks like paper: brighter and less colourful
 * than its surroundings, and evenly so (a shadow or a piece of table inside
 * the quad pulls this down). 0..1.
 */
function paperScore(cv, gray, sat, pts, mats) {
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1)
  const outside = new cv.Mat()
  mats.push(mask, outside)
  const poly = cv.matFromArray(4, 1, cv.CV_32SC2, pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)]))
  const polys = new cv.MatVector()
  polys.push_back(poly)
  cv.fillPoly(mask, polys, new cv.Scalar(255))
  poly.delete()
  polys.delete()
  cv.bitwise_not(mask, outside)
  const meanIn = new cv.Mat()
  const devIn = new cv.Mat()
  mats.push(meanIn, devIn)
  cv.meanStdDev(gray, meanIn, devIn, mask)
  const brightIn = meanIn.doubleAt(0, 0)
  const spreadIn = devIn.doubleAt(0, 0)
  const brightOut = cv.mean(gray, outside)[0]
  const satIn = cv.mean(sat, mask)[0]
  const contrast = Math.max(0, Math.min(1, (brightIn - brightOut) / 50))
  const pale = 1 - Math.min(1, satIn / 120)
  const even = 1 - Math.min(1, spreadIn / 80)
  return 0.45 * contrast + 0.35 * pale + 0.2 * even
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
    const src = cv.matFromImageData(getImageData(canvas))
    const gray = new cv.Mat()
    const blur = new cv.Mat()
    mats.push(src, gray, blur)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    // A median blur keeps paper edges sharp but wipes out wood grain, cloth and print.
    cv.medianBlur(gray, blur, 7)
    const frame = { width: canvas.width, height: canvas.height }
    const kernel3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    const kernel7 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7))
    mats.push(kernel3, kernel7)
    const candidates = []
    const tryEdges = (edges) => {
      candidates.push(...bestQuad(cv, edges, frame, mats))
    }

    // Pass 1: edges with thresholds that follow the picture's own brightness.
    const median = medianOf(blur)
    const edges1 = new cv.Mat()
    mats.push(edges1)
    cv.Canny(blur, edges1, Math.max(10, 0.66 * median), Math.min(255, 1.33 * median + 40))
    cv.morphologyEx(edges1, edges1, cv.MORPH_CLOSE, kernel3)
    cv.dilate(edges1, edges1, kernel3)
    tryEdges(edges1)

    // Pass 2: fixed thresholds (strong contrast).
    const edges2 = new cv.Mat()
    mats.push(edges2)
    cv.Canny(blur, edges2, 60, 180)
    cv.dilate(edges2, edges2, kernel3)
    tryEdges(edges2)

    // Pass 3: bright paper on a darker background, as one solid shape.
    const otsu = new cv.Mat()
    mats.push(otsu)
    cv.threshold(blur, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    cv.morphologyEx(otsu, otsu, cv.MORPH_CLOSE, kernel7)
    cv.morphologyEx(otsu, otsu, cv.MORPH_OPEN, kernel7)
    tryEdges(otsu)

    // Pass 4: colour. Paper is grey/white while tables and cloth have colour.
    const hsv = new cv.Mat()
    const channels = new cv.MatVector()
    mats.push(hsv, channels)
    const rgb = new cv.Mat()
    mats.push(rgb)
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)
    cv.split(hsv, channels)
    const sat = channels.get(1)
    mats.push(sat)
    const satBlur = new cv.Mat()
    const lowSat = new cv.Mat()
    mats.push(satBlur, lowSat)
    cv.medianBlur(sat, satBlur, 7)
    cv.threshold(satBlur, lowSat, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)
    cv.morphologyEx(lowSat, lowSat, cv.MORPH_CLOSE, kernel7)
    tryEdges(lowSat)

    // Pass 5: adaptive threshold (low-contrast paper on a light table).
    const thresh = new cv.Mat()
    const edges5 = new cv.Mat()
    mats.push(thresh, edges5)
    cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 5)
    cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel7)
    cv.Canny(thresh, edges5, 50, 150)
    cv.dilate(edges5, edges5, kernel3)
    tryEdges(edges5)

    // Shape first, then how much the inside looks like paper.
    // Edges widened a little, so a side a few pixels off still counts.
    const support = new cv.Mat()
    mats.push(support)
    cv.dilate(edges1, support, kernel7)
    for (const cand of candidates) {
      cand.total = cand.score * (0.35 + 0.65 * paperScore(cv, blur, satBlur, cand.pts, mats)) * (0.3 + 0.7 * edgeSupport(support, cand.pts))
    }
    const best = candidates.sort((a, b) => b.total - a.total)[0]
    if (best) best.pts = refineCorners(edges2, best.pts, frame)
    const frameArea = frame.width * frame.height
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
