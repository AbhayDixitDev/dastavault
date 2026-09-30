import { Hono } from 'hono'

const health = new Hono()

health.get('/', (c) =>
  c.json({
    ok: true,
    service: 'dastavault-api',
    time: new Date().toISOString(),
    request_id: c.get('requestId'),
  }),
)

export default health
