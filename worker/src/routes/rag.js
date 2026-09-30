import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { notImplemented } from '../lib/errors.js'

/**
 * Phase 8 - "Ask your documents" (RAG over document_chunks).
 * Mounted at /api/workspaces/:ws/rag. Retrieval must apply workspace + permission
 * constraints inside SQL (PRD 9.12). AI provider keys come from ai_provider_keys.
 */
const rag = new Hono()

// POST /rag/ask { question, document_ids?, top_k? }
rag.post('/ask', requireRole('viewer'), () => {
  throw notImplemented()
})

// POST /rag/index/:docId  - (re)index a document's text into document_chunks (editor+)
rag.post('/index/:docId', requireRole('editor'), () => {
  throw notImplemented()
})

// GET /rag/status/:docId
rag.get('/status/:docId', () => {
  throw notImplemented()
})

export default rag
