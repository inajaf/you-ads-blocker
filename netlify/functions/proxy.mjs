import { handleProxy } from '../../server/proxy-core.mjs'

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
      },
      body: '',
    }
  }
  const qs = event.queryStringParameters || {}
  const result = await handleProxy(qs.path || '', qs.base || '')
  return {
    statusCode: result.status,
    headers: result.headers,
    body: result.body,
  }
}
