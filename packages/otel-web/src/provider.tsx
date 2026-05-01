"use client";

import { type ReactNode, useEffect } from "react";
import { initWebOtel, type OtelWebOptions } from "./init.js";

export interface OtelProviderProps {
  options: OtelWebOptions;
  children: ReactNode;
}

/**
 * Mount once at the root of your app (`app/layout.tsx`). Calls
 * {@link initWebOtel} on first mount and is a no-op after that.
 *
 *   import { OtelProvider } from "@plinth-dev/otel-web";
 *
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html>
 *         <body>
 *           <OtelProvider
 *             options={{
 *               serviceName: "items-web",
 *               serviceVersion: process.env.NEXT_PUBLIC_VERSION!,
 *               moduleName: "items",
 *               environment: process.env.NEXT_PUBLIC_ENV!,
 *             }}
 *           >
 *             {children}
 *           </OtelProvider>
 *         </body>
 *       </html>
 *     );
 *   }
 */
export function OtelProvider(props: OtelProviderProps): ReactNode {
  // initWebOtel is idempotent (logs + no-ops on re-init), so it's safe
  // to depend on props.options even though it shouldn't change.
  useEffect(() => {
    initWebOtel(props.options);
  }, [props.options]);
  return props.children;
}
