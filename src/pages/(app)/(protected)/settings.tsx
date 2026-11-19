/**
 * Example gated page. Reached at /settings — no auth logic lives here
 * because (protected)/_layout.tsx already wraps the subtree in <AuthGate>.
 *
 * The Characters card is the reset path ADR 0018 describes: the caller's own
 * characters are listed and `Delete <name>` opens a confirm dialog that calls
 * the owner-only `deleteCharacter` action (which drains the pack first). The
 * page never writes a collection itself; `/home` shows Forge again because the
 * sheet there is query-driven.
 */

import { useState } from 'react'
import { signOut, useAuth, useQuery, useUser, type RecordData } from 'deepspace'
import { Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { DEFAULT_CAMPAIGN_ID } from '@/constants'
import { callAction } from '@/lib/actions'
import type { CharacterRow } from '@/lib/preview-data'

/** `deleteCharacter`'s success data, spelled out locally: importing the action
 *  module for its type would put worker-only modules (zod, `deepspace/worker`)
 *  in this page's import graph — the same reason `home.tsx` spells out
 *  `SeedResult`. */
interface DeleteResult {
  characterId: string
  deletedItems: number
}

/** `ActionCallError` is an `Error`, so one branch covers every refusal. */
function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request was refused.'
}

export default function SettingsPage() {
  const { user } = useUser()
  const { userId } = useAuth()

  return (
    // No background on page wrappers — pages render into whatever the app's
    // (app)/_layout provides (a plain background, or a raised panel), so they
    // stay transparent and inherit it.
    <div className="min-h-full text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="mb-12 text-4xl font-bold tracking-tight">Settings</h1>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Your account</h2>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="text-foreground">{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>

          <Button variant="secondary" className="mt-6" onClick={() => signOut()}>
            Sign out
          </Button>
        </section>

        <CharactersCard userId={userId} />
      </div>
    </div>
  )
}

/**
 * The caller's character at this table, with a destructive reset.
 *
 * The read is scoped in the query and again by `userId` below: a missing
 * `userId` would otherwise widen the `where` to every character in the campaign
 * and offer a Delete button for someone else's adventurer.
 */
function CharactersCard({ userId }: { userId: string | null }) {
  const { records, status } = useQuery<CharacterRow>('characters', {
    where: {
      campaignId: DEFAULT_CAMPAIGN_ID,
      ...(userId ? { userId } : {}),
    },
  })
  const { success, error } = useToast()

  // One dialog for the list, and one write at a time: `pending` names the row
  // the dialog is about, `pendingId` the row currently being deleted.
  const [pending, setPending] = useState<RecordData<CharacterRow> | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const characters = userId ? records.filter((record) => record.data.userId === userId) : []
  const deleting = pending !== null && pendingId === pending.recordId

  async function deleteCharacter(): Promise<void> {
    if (pending === null || pendingId !== null) return
    const { recordId, data } = pending
    setPendingId(recordId)
    try {
      await callAction<DeleteResult>('deleteCharacter', { characterId: recordId })
      success('Character deleted', `${data.name} left the table.`)
    } catch (cause) {
      // Close either way: the toast carries the refusal, and a stuck modal
      // would hide the list behind a dialog the user cannot clear.
      error('Character not deleted', failureMessage(cause))
    } finally {
      setPendingId(null)
      setPending(null)
    }
  }

  return (
    <section
      data-testid="characters-settings"
      className="mt-8 rounded-lg border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold">Characters</h2>
      <div className="pixel-rule mb-4" />

      {status === 'loading' && (
        <div
          data-testid="characters-loading"
          aria-busy="true"
          aria-label="Loading your characters"
          className="h-14 animate-pulse rounded-md bg-muted"
        />
      )}

      {status === 'error' && (
        <div data-testid="characters-read-error" className="text-sm">
          <span className="font-pixel text-[10px] uppercase text-destructive">Unavailable</span>
          <p className="mt-1 text-muted-foreground">
            Your characters could not be read. Reload to try again.
          </p>
        </div>
      )}

      {status === 'ready' && characters.length === 0 && (
        <div data-testid="characters-empty" className="text-sm">
          <p className="text-muted-foreground">No character at this table.</p>
          <Link to="/home" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
            Forge one at the table
          </Link>
        </div>
      )}

      {status === 'ready' && characters.length > 0 && (
        <ul className="flex flex-col">
          {characters.map((character, index) => (
            <li
              key={character.recordId || `${character.data.name}-${String(index)}`}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
            >
              <div>
                <p className="font-medium text-foreground">{character.data.name}</p>
                <p className="mt-1 font-pixel text-[10px] uppercase text-muted-foreground">
                  {character.data.archetype} · {character.data.hp}/{character.data.maxHp} HP
                </p>
              </div>

              <Button
                data-testid="delete-character"
                variant="destructive"
                size="sm"
                disabled={pendingId !== null}
                onClick={() => {
                  setPending(character)
                }}
              >
                <Trash2 aria-hidden />
                Delete {character.data.name}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={pending !== null}
        onClose={() => {
          setPending(null)
        }}
        onConfirm={() => {
          void deleteCharacter()
        }}
        title={pending ? `Delete "${pending.data.name}"?` : 'Delete character?'}
        description={
          pending
            ? `${pending.data.name} and everything they carry are removed for good. This cannot be undone.`
            : undefined
        }
        confirmText="Delete character"
        variant="destructive"
        loading={deleting}
      />
    </section>
  )
}
