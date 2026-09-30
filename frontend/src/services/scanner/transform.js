/**
 * Straightening, rotation and enhancement of scanned pages.
 *
 *   perspectiveWarp(source, corners) -> Promise<canvas>   (rectangle crop when OpenCV is missing)
 *   rotateCanvas(canvas, deg) -> canvas
 *   enhance(canvas, mode, { brightness, contrast }) -> canvas   mode: 'color'|'grayscale'|'bw'|'auto'
 *
 * All OpenCV Mats are deleted. Every function also works without OpenCV.
 */
import { getCv, deleteAll } from './opencv.js'
import { makeCanvas, toCanvas, getImageData, sourceSize } from './imageUtils.js'
import { orderCorners } from './detect.js'

const MAX_WARP_SIDE = 2600

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Natural output size of the quadrilateral. */
export function quadSize(corners) {
  const [tl, tr, br, bl] = corners
  const width = Math.max(dist(tl, tr), dist(bl, br))
  const height = Math.max(dist(tl, bl), dist(tr, br))
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

export function boundingRect(corners) {
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
}

/** Rectangle crop used when there is no OpenCV or the quad is already a rectangle. */
export function cropRect(source, corners) {
  const r = boundingRect(corners)
  const canvas = makeCanvas(r.width, r.height)
  canvas.getContext('2d').drawImage(source, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function isRectangle(corners, tolerance = 1.5) {
  const [tl, tr, br, bl] = corners
  return Math.abs(tl.y - tr.y) <= tolerance && Math.abs(bl.y - br.y) <= tolerance && Math.abs(tl.x - bl.x) <= tolerance && Math.abs(tr.x - br.x) <= tolerance
}

/**
 * Straighten the page inside `corners` (TL, TR, BR, BL in source pixels).
 * Returns a canvas of the quad's natural size (capped at 2600px on the long side).
 */
export async function perspectiveWarp(source, cornersIn) {
  const corners = orderCorners(cornersIn.map((c) => ({ x: +c.x || 0, y: +c.y || 0 })))
  if (isRectangle(corners)) return cropRect(source, corners)
  const cv = await getCv()
  if (!cv) return cropRect(source, corners)

  const mats = []
  try {
    const { canvas, scale } = toCanvas(source, MAX_WARP_SIDE)
    const scaled = corners.map((c) => ({ x: c.x * scale, y: c.y * scale }))
    const { width, height } = quadSize(scaled)
    const src = cv.matFromImageData(getImageData(canvas))
    const dst = new cv.Mat()
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, scaled.flatMap((c) => [c.x, c.y]))
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
    const M = cv.getPerspectiveTransform(srcTri, dstTri)
    mats.push(src, dst, srcTri, dstTri, M)
    cv.warpPerspective(src, dst, M, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar())
    const out = makeCanvas(width, height)
    const imageData = new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows)
    out.getContext('2d').putImageData(imageData, 0, 0)
    return out
  } catch {
    return cropRect(source, corners)
  } finally {
    deleteAll(mats)
  }
}

/** Rotate a canvas (or any drawable) by 90-degree steps clockwise. */
export function rotateCanvas(source, deg) {
  const d = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  const { width, height } = sourceSize(source)
  const swap = d === 90 || d === 270
  const out = makeCanvas(swap ? height : width, swap ? width : height)
  const ctx = out.getContext('2d')
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((d * Math.PI) / 180)
  ctx.drawImage(source, -width / 2, -height / 2)
  return out
}

/** Map a point through the same clockwise rotation used by rotateCanvas. */
export function rotatePoint(p, deg, width, height) {
  const d = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  if (d === 90) return { x: height - p.y, y: p.x }
  if (d === 180) return { x: width - p.x, y: height - p.y }
  if (d === 270) return { x: p.y, y: width - p.x }
  return { x: p.x, y: p.y }
}

/** Rotate a set of corners with the image (90 degrees clockwise), keeping TL,TR,BR,BL order. */
export function rotateCorners(corners, width, height) {
  return orderCorners(corners.map((p) => rotatePoint(p, 90, width, height)))
}

/* --------------------------------------------------------- enhance */

function luminance(d, i) {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
}

function contrastStretch(data) {
  const hist = new Uint32Array(256)
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) hist[luminance(data, i) | 0]++
  let lo = 0
  let hi = 255
  let acc = 0
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.01) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.01) { hi = i; break } }
  if (hi - lo < 20) return
  const k = 255 / (hi - lo)
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, (i - lo) * k))
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

function sharpen(imageData, amount = 0.35) {
  const { width, height, data } = imageData
  const src = new Uint8ClampedArray(data)
  const w4 = width * 4
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * w4 + x * 4
      for (let c = 0; c < 3; c++) {
        const center = src[i + c]
        const around = src[i - w4 + c] + src[i + w4 + c] + src[i - 4 + c] + src[i + 4 + c]
        data[i + c] = Math.max(0, Math.min(255, center + amount * (4 * center - around)))
      }
    }
  }
}

function toGray(data) {
  for (let i = 0; i < data.length; i += 4) {
    const l = luminance(data, i)
    data[i] = data[i + 1] = data[i + 2] = l
  }
}

/** Adaptive (local mean) threshold using an integral image; works without OpenCV. */
function adaptiveThreshold(imageData, blockSize = 31, c = 12) {
  const { width, height, data } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = luminance(data, i)
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 1; y <= height; y++) {
    let row = 0
    for (let x = 1; x <= width; x++) {
      row += gray[(y - 1) * width + (x - 1)]
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row
    }
  }
  const half = blockSize >> 1
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const count = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum = integral[(y1 + 1) * (width + 1) + (x1 + 1)] - integral[y0 * (width + 1) + (x1 + 1)] - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0]
      const v = gray[y * width + x] > sum / count - c ? 255 : 0
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
    }
  }
}

function brightnessContrast(data, brightness = 0, contrast = 0) {
  if (!brightness && !contrast) return
  const k = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const lut = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, k * (i - 128) + 128 + brightness))
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

export const ENHANCE_MODES = ['auto', 'color', 'grayscale', 'bw']

/**
 * Apply a filter to a canvas and return a new canvas.
 * brightness: -100..100, contrast: -100..100.
 */
export function enhance(source, mode = 'auto', { brightness = 0, contrast = 0 } = {}) {
  try {
    const { canvas } = toCanvas(source)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = imageData
    switch (mode) {
      case 'grayscale':
        toGray(data)
        contrastStretch(data)
        break
      case 'bw':
        brightnessContrast(data, brightness, contrast)
        adaptiveThreshold(imageData)
        break
      case 'color':
        break
      case 'auto':
      default:
        contrastStretch(data)
        if (canvas.width * canvas.height <= 3000 * 3000) sharpen(imageData, 0.3)
        break
    }
    if (mode !== 'bw') brightnessContrast(data, brightness, contrast)
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch {
    return toCanvas(source).canvas
  }
}
