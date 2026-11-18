/**
 * Signed-out banner — the preview's one call to action. `/home` is a tier-2
 * page (no `AuthGate`), so this panel owns its own `<AuthOverlay>` state and
 * nothing else in the shell is gated (`P1.9`).
 *
 * `AuthOverlay` comes from the SDK, not `@/components/ui`.
 */

import { useState } from 'react'
import { AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'

export function SignInBanner() {
  const [open, setOpen] = useState(false)

  return (
    <div
      data-testid="signed-out-banner"
      className="pixel-frame flex flex-wrap items-center justify-between gap-3 bg-secondary px-4 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-pixel text-[10px] uppercase text-primary">SIGNED OUT PREVIEW</span>
        <p className="text-xs text-muted-foreground">
          You are watching the real table. Sign in to roll, speak, and take damage.
        </p>
      </div>

      <Button size="sm" onClick={() => setOpen(true)}>
        Sign in
      </Button>

      {open && <AuthOverlay onClose={() => setOpen(false)} />}
    </div>
  )
}
