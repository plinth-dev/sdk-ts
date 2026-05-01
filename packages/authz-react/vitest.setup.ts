import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react doesn't auto-clean across vitest tests when
// `globals: true` isn't enabled. Explicit cleanup() between tests
// prevents previous-render DOM from leaking into queries.
afterEach(() => {
  cleanup();
});
