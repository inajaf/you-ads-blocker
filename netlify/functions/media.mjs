import { handleMediaProxy } from '../../server/media-proxy.mjs'

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range, Accept',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      },
      body: '',
    }
  }

  if (event.httpMethod !== 'GET' || event.headers?.['sec-fetch-dest'] === 'document') {
    return {
      statusCode: 405,
      headers: {
        Allow: 'GET',
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
      },
      body: JSON.stringify({ error: 'Media requests must use GET', code: 'BAD_METHOD' }),
    }
  }

  const qs = event.queryStringParameters || {}
  const target = qs.url || ''
  if (!target) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
      body: JSON.stringify({ error: 'Missing url', code: 'BAD_MEDIA_URL' }),
    }
  }

  const result = await handleMediaProxy(target, event.headers || {})
  const body =
    typeof result.body === 'string'
      ? result.body
      : Buffer.isBuffer(result.body)
        ? result.body.toString('base64')
        : result.body

  return {
    statusCode: result.status,
    headers: result.headers,
    body,
    isBase64Encoded: typeof result.body !== 'string',
  }
}
