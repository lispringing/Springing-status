import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRequestApiKey } from '../api/status.js'

test('parseRequestApiKey prefers EdgeOne env values from context', async () => {
  const result = await parseRequestApiKey({
    env: { UPTIMEROBOT_API_KEY: 'edge-key' },
    request: new Request('https://example.com/api/status?api_key=ignored')
  })

  assert.equal(result, 'edge-key')
})

test('parseRequestApiKey falls back to request query for standard Request objects', async () => {
  const result = await parseRequestApiKey(new Request('https://example.com/api/status?apiKey=from-query'))

  assert.equal(result, 'from-query')
})
