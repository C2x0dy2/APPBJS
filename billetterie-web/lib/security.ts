const CSP_PROD = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

// Vite injects inline styles and uses a WebSocket for HMR in development.
const CSP_DEV = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' ws: wss: http: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

/**
 * Add the security headers to every response, including dynamic HTML pages.
 * Cloudflare `_headers` rules only apply to static assets, so this wrapper is
 * the authoritative place for CSP, Referrer-Policy and friends.
 */
export function withSecurityHeaders(response: Response, url: URL, dev: boolean): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', dev ? CSP_DEV : CSP_PROD);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(self)');
  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const body = [101, 204, 205, 304].includes(response.status) ? null : response.body;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
