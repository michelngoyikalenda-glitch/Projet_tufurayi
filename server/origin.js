const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedOrigin(origin, expectedOrigin, production = process.env.NODE_ENV === 'production') {
  if (origin === expectedOrigin) return true;
  if (production || !origin || !expectedOrigin) return false;

  try {
    const request = new URL(origin);
    const expected = new URL(expectedOrigin);
    return request.origin === origin && expected.origin === expectedOrigin &&
      request.protocol === expected.protocol && request.port === expected.port &&
      loopbackHosts.has(request.hostname) && loopbackHosts.has(expected.hostname);
  } catch {
    return false;
  }
}
