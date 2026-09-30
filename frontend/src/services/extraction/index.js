/**
 * Rule-based extraction (contract section 10).
 *   extractSuggestions(text, { people, groups, workspaceKind })
 *   suggestDocumentName({ suggestions, people, fallbackName })
 *   perceptualHash(imageBlob), hammingDistance(a, b)
 *   chunkText(text, pages)
 */
export { extractSuggestions, suggestDocumentName, detectDocumentType, findNumbers, findAmount, findEmail, findPhone, findOrganisation, matchPeople, matchGroups, findKeywords, makeSummary } from './rules.js'
export { findDates, classifyDates } from './dates.js'
export { chunkText } from './chunk.js'
export { perceptualHash, hammingDistance, dHashFromGray } from './hash.js'
export { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_KEYS, typeLabel } from './documentTypes.js'
