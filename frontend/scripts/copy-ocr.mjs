// Copies the text reader (Tesseract) and its English data into public/tesseract,
// and the face models into public/models/face,
// so the app reads photos without downloading anything first. Runs before
// every build (npm "prebuild").
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'tesseract')
mkdirSync(join(out, 'core'), { recursive: true })
mkdirSync(join(out, 'lang'), { recursive: true })

cpSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'))
for (const f of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  cpSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f))
}
cpSync(join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'))
cpSync(join(nm, '@tesseract.js-data/hin/4.0.0_best_int/hin.traineddata.gz'), join(out, 'lang', 'hin.traineddata.gz'))
console.log('Text reader copied to public/tesseract')

// Face finder (faces on ID cards and photos): detector, landmarks, face fingerprints.
const faces = join(root, 'public', 'models', 'face')
mkdirSync(faces, { recursive: true })
// SSD MobileNet finds faces far more reliably than the tiny detector (small, turned or dim faces on ID cards).
for (const name of ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model']) {
  for (const ext of ['-weights_manifest.json', '.bin']) {
    cpSync(join(nm, '@vladmandic/face-api/model', name + ext), join(faces, name + ext))
  }
}
console.log('Face models copied to public/models/face')

// Paper edge finder for the scanner and crop (OpenCV.js, ~13 MB).
mkdirSync(join(root, 'public', 'opencv'), { recursive: true })
cpSync(join(nm, '@techstark/opencv-js/dist/opencv.js'), join(root, 'public', 'opencv', 'opencv.js'))
console.log('OpenCV copied to public/opencv')

// Meaning search (sentence embeddings): the ONNX runtime and the model, so search
// does not first download ~35 MB from jsDelivr and Hugging Face on the phone.
const ort = join(root, 'public', 'ort')
mkdirSync(ort, { recursive: true })
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  cpSync(join(nm, 'onnxruntime-web/dist', f), join(ort, f))
}
console.log('ONNX runtime copied to public/ort')

const MODEL = 'Xenova/all-MiniLM-L6-v2'
const modelDir = join(root, 'public', 'models', MODEL)
const modelFiles = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
const { existsSync, writeFileSync } = await import('node:fs')
let missing = 0
for (const f of modelFiles) {
  const target = join(modelDir, f)
  if (existsSync(target)) continue
  try {
    const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${f}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    missing++
    console.warn(`Could not download ${MODEL}/${f} (${err.message}); the app downloads it on first use instead.`)
  }
}
if (!missing) console.log(`Search model ready in public/models/${MODEL}`)
// Tells the app whether to look for the model here first (see embedding.worker.js).
writeFileSync(join(root, 'public', 'models', 'search-model.json'), JSON.stringify({ model: MODEL, local: !missing }))
