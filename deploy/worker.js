const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* http://[::1]:*; manifest-src 'self'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    const secured = new Response(response.body, response)
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      secured.headers.set(name, value)
    }
    return secured
  },
}
