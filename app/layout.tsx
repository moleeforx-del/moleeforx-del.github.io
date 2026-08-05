import type { ReactNode } from 'react'

/**
 * Deliberately bare. The Framer export renders `<html>` and `<body>` with no
 * attributes and no wrapper elements -- `#main` is a direct child of `<body>`
 * and the generated cascade depends on that -- so the layout adds nothing.
 *
 * Per-page `<head>` content (font faces, breakpoint CSS, the SSR component
 * stylesheet) is emitted by each route and hoisted into `<head>` by React.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
