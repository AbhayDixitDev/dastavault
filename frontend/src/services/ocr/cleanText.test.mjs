// Run with: node --test src/services/ocr/cleanText.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLines } from './cleanText.js'

const line = (pairs, confidence) => ({ text: pairs.map(([t]) => t).join(' '), confidence, words: pairs.map(([text, c]) => ({ text, confidence: c })) })

test('cleanLines drops noise from the photo and keeps the printed text', () => {
  const text = cleanLines([
    line([['AX', 0.27], ['©', 0.74], ['5%', 0.27], ['lt', 0.22], ['J', 0.67]], 0.44),
    line([['°', 0.52], ['3', 0.77]], 0.64),
    line([['EMPLOYEE', 0.96], ['DATA', 0.96], ['CONF!', 0.75]], 0.89),
    line([['EMPLOYEE', 0.93], ['DATA', 0.96], ['CONFIDENTIALITY', 0.96], ['NON-DISCLOSURE', 0.93], ['\\', 0.73]], 0.91),
    line([['N-DISCLOSURE', 0.87], ['UNDERTAKING', 0.96]], 0.91),
    null,
    line([['|', 0.95], ['shall', 0.96], ['not', 0.94], ['retain', 0.96], ['गे', 0.04], ['data', 0.92]], 0.8),
  ])
  assert.equal(text, 'EMPLOYEE DATA CONFIDENTIALITY NON-DISCLOSURE\nUNDERTAKING\n\nI shall not retain data')
})
