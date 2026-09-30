import { SignJWT } from 'jose'
import app from '../src/index.js'

const secret = 'test-secret-test-secret-test-secret-1234'
const env = {
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  SUPABASE_JWT_SECRET: secret,
  FILE_URL_SIGNING_SECRET: 'file-secret',
  VAULT_RECOVERY_SECRET: 'vault-secret',
  ALLOWED_ORIGINS: 'http://localhost:5173, https://app.example.com',
  APP_URL: 'http://localhost:5173',
  LOG_REQUESTS: 'false',
  DOCUMENTS_BUCKET: {},
}
const token = await new SignJWT({ email: 'Neeraj@Example.com', role: 'authenticated' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('11111111-2222-4333-8444-555555555555')
  .setAudience('authenticated')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(secret))

async function hit(method, path, { body, auth = false, headers = {} } = {}) {
  const h = { ...headers }
  if (auth) h.authorization = `Bearer ${token}`
  if (body) h['content-type'] = 'application/json'
  const res = await app.fetch(new Request(`http://localhost:8787${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  console.log(`${method} ${path} -> ${res.status}`, typeof json === 'string' ? json.slice(0, 80) : JSON.stringify(json).slice(0, 160))
  return { res, json }
}

await hit('GET', '/api/health')
await hit('GET', '/nope')
await hit('GET', '/api/me')                                  // 401 missing token
await hit('GET', '/api/me', { auth: true })                  // 500 db unreachable (proves auth passed)
await hit('GET', '/api/workspaces/not-a-uuid/members', { auth: true })   // 400 invalid workspace id (proves :ws propagates)
await hit('GET', '/api/workspaces/not-a-uuid', { auth: true })           // 400
await hit('GET', '/api/workspaces/not-a-uuid/documents/x/versions', { auth: true }) // 400
await hit('POST', '/api/workspaces', { auth: true, body: { name: '', kind: 'zoo' } })  // 400 validation
await hit('POST', '/api/vault/setup', { auth: true, body: { pin_salt: 'abc' } })     // 400 validation
await hit('GET', '/api/files/11111111-2222-4333-8444-555555555555?exp=9999999999&sig=bad') // 401
await hit('GET', '/api/files/11111111-2222-4333-8444-555555555555?exp=1&sig=bad')          // 401 expired
await hit('POST', '/api/invites/short/accept', { auth: true })                        // 400 invalid token
await hit('GET', '/api/workspaces/11111111-2222-4333-8444-555555555555/search', { auth: true }) // 500 db (middleware reached db)
const opt = await app.fetch(new Request('http://localhost:8787/api/me', { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' } }), env)
console.log('OPTIONS cors ->', opt.status, opt.headers.get('access-control-allow-origin'))
const bad = await app.fetch(new Request('http://localhost:8787/api/health', { headers: { origin: 'https://evil.example' } }), env)
console.log('GET bad origin ->', bad.status, 'ACAO=', bad.headers.get('access-control-allow-origin'), 'CSP=', bad.headers.get('content-security-policy'))

// rate limit: 21 unlock attempts -> last one 429 (before hitting DB since vault load fails first... rateLimit runs before handler)
let last
for (let i = 0; i < 21; i++) last = await app.fetch(new Request('http://localhost:8787/api/vault/unlock', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ pin_verifier_hash: 'aGVsbG8=' }) }), env)
console.log('21st unlock ->', last.status, await last.text())

// signing round trip
const { signFileUrl, verifyFileSignature } = await import('../src/lib/signing.js')
const s = await signFileUrl(env, 'http://localhost:8787', 'abc')
const u = new URL(s.url)
console.log('sign ok ->', await verifyFileSignature(env, 'abc', u.searchParams.get('exp'), u.searchParams.get('sig')), 'tampered ->', await verifyFileSignature(env, 'abd', u.searchParams.get('exp'), u.searchParams.get('sig')))

// vault key wrap round trip
const { wrapVaultKey, unwrapVaultKey } = await import('../src/lib/vaultCrypto.js')
const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const wrapped = await wrapVaultKey(env, 'user-1', raw)
console.log('wrap ok ->', (await unwrapVaultKey(env, 'user-1', wrapped)) === raw, wrapped.slice(0, 12))
try { await unwrapVaultKey(env, 'user-2', wrapped); console.log('WRONG: other user unwrapped') } catch (e) { console.log('other user blocked ->', e.code) }

// mime
const { detectAllowedType } = await import('../src/lib/mime.js')
console.log('mime pdf ->', detectAllowedType(new TextEncoder().encode('%PDF-1.7 blah'), 'application/octet-stream', 'bin'))
console.log('mime png ->', detectAllowedType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), '', ''))
console.log('mime exe ->', detectAllowedType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 'image/png', 'png'))
console.log('mime txt ->', detectAllowedType(new TextEncoder().encode('hello world'), 'text/plain', 'txt'))

