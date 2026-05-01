// `server-only`'s runtime check throws unless bundlers apply the
// "react-server" export condition (Next.js does; Vitest doesn't by default).
// Pre-clear the module-cache entry to a no-op so the actual import is harmless.
//
// This setup file is loaded by vitest before tests; the require.cache hack
// runs once per worker.
const noop = {};
const path = require.resolve("server-only");
require.cache[path] = {
  id: path,
  filename: path,
  exports: noop,
  loaded: true,
} as NodeModule;
