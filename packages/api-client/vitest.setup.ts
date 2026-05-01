// `server-only`'s runtime check throws unless bundlers apply the
// "react-server" export condition (Next.js does; Vitest doesn't by default).
// Pre-clear the module-cache entry to a no-op so the actual import is harmless.
const noop = {};
const path = require.resolve("server-only");
require.cache[path] = {
  id: path,
  filename: path,
  exports: noop,
  loaded: true,
} as NodeModule;
