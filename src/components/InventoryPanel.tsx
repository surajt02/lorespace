/**
 * Inventory panel — what the character is carrying (`P1.10`, `P3.3`, `P3.6`).
 *
 * Rows arrive already filtered to the viewer's character, so this panel never
 * decides ownership. `preview` renders the fixture list read-only; `live` adds
 * `Use` (consumables only) and `Discard`, both backed by awaited confirmed
 * writes — a refused write surfaces as a toast, never as a silent no-op.
 *
 * "Use" spends one charge and nothing else: this build has no healing, damage
 * or item effects (ADR 0010), and no add/edit form (ADR 0008).
 */

import { useState, type ReactNode } from 'react'
import { useMutations, type RecordData } from 'deepspace'
import { Backpack } from 'lucide-react'
import { Badge, Button, ConfirmModal, EmptyState, useToast } from '@/components/ui'
import type { QueryStatus, SheetMode } from '@/components/CharacterSheetPanel'
import type { InventoryRow } from '@/lib/preview-data'

/** `removeConfirmed`/`putConfirmed` reject with a plain `Error`; keep one wording. */
function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The write was refused.'
}

export function InventoryPanel({
  mode,
  status,
  items,
}: {
  mode: SheetMode
  status: QueryStatus
  items: RecordData<InventoryRow>[]
}) {
  const inventory = useMutations<InventoryRow>('inventory')
  const { success, error } = useToast()

  // One write at a time, and one modal for the whole list: `pendingDiscard`
  // names the row the dialog is about, `pendingId` the row currently writing.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pendingDiscard, setPendingDiscard] = useState<RecordData<InventoryRow> | null>(null)

  const live = mode === 'live'

  async function spendItem(item: RecordData<InventoryRow>): Promise<void> {
    if (pendingId !== null || !inventory.ready) return
    const { itemName, quantity } = item.data
    setPendingId(item.recordId)
    try {
      if (quantity > 1) {
        await inventory.putConfirmed(item.recordId, { quantity: quantity - 1 })
        success(`Used ${itemName}`, `${quantity - 1} left.`)
      } else {
        await inventory.removeConfirmed(item.recordId)
        success(`Used ${itemName}`, 'That was the last one.')
      }
    } catch (cause) {
      error(`Could not use ${itemName}`, failureMessage(cause))
    } finally {
      setPendingId(null)
    }
  }

  async function discardItem(): Promise<void> {
    if (pendingDiscard === null || pendingId !== null || !inventory.ready) return
    const { recordId, data } = pendingDiscard
    setPendingId(recordId)
    try {
      await inventory.removeConfirmed(recordId)
      success(`Discarded ${data.itemName}`)
    } catch (cause) {
      // Close either way: the toast carries the refusal, and a stuck modal
      // would hide the list behind a dialog the user cannot clear.
      error(`Could not discard ${data.itemName}`, failureMessage(cause))
    } finally {
      setPendingId(null)
      setPendingDiscard(null)
    }
  }

  const discarding = pendingDiscard !== null && pendingId === pendingDiscard.recordId

  return (
    <>
      {live && status === 'loading' && <InventorySkeleton />}

      {live && status === 'error' && <InventoryReadError />}

      {(!live || status === 'ready') && (
        <InventoryShell count={items.length}>
          {items.length === 0 ? (
            <EmptyState
              icon={<Backpack aria-hidden />}
              title="Nothing carried"
              description="Loot from the vault shows up here."
            />
          ) : (
            <ul className="mt-2 flex flex-col">
              {items.map((item, index) => (
                <ItemRow
                  key={item.recordId || `${item.data.itemName}-${index}`}
                  item={item}
                  writing={pendingId === item.recordId}
                  actions={
                    live ? (
                      <ItemActions
                        item={item}
                        ready={inventory.ready}
                        busy={pendingId !== null}
                        writing={pendingId === item.recordId}
                        onUse={() => {
                          void spendItem(item)
                        }}
                        onDiscard={() => {
                          setPendingDiscard(item)
                        }}
                      />
                    ) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </InventoryShell>
      )}

      <ConfirmModal
        open={pendingDiscard !== null}
        onClose={() => {
          setPendingDiscard(null)
        }}
        onConfirm={() => {
          void discardItem()
        }}
        title={pendingDiscard ? `Discard "${pendingDiscard.data.itemName}"?` : 'Discard item?'}
        description={
          pendingDiscard
            ? pendingDiscard.data.quantity === 1
              ? 'It leaves the pack for good. This cannot be undone.'
              : `All ${pendingDiscard.data.quantity} leave the pack for good. This cannot be undone.`
            : undefined
        }
        confirmText="Discard"
        variant="destructive"
        loading={discarding}
      />
    </>
  )
}

/**
 * The live read failed. The fixture list is not a fallback here: showing items
 * the collection does not hold is the lie ADR 0014 rules out.
 */
function InventoryReadError() {
  return (
    <section data-testid="inventory-read-error" className="pixel-frame bg-card p-3">
      <span className="font-pixel text-[10px] uppercase text-destructive">Unavailable</span>
      <p className="mt-1 text-xs text-muted-foreground">
        The pack is unavailable. Reload to try again.
      </p>
    </section>
  )
}

/** Three empty rows, the same height as three items. */
function InventorySkeleton() {
  return (
    <section
      data-testid="inventory-skeleton"
      aria-busy="true"
      aria-label="Loading the inventory"
      className="pixel-frame bg-card"
    >
      <header className="flex items-center justify-between px-3 pt-3">
        <div className="h-2.5 w-16 animate-pulse rounded-sm bg-muted" />
        <div className="h-2.5 w-4 animate-pulse rounded-sm bg-muted" />
      </header>
      <ul className="mt-2 flex flex-col">
        {[0, 1, 2].map((index) => (
          <li
            key={index}
            className="border-t border-border px-3 py-2 first:border-t-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="h-3 w-1/2 animate-pulse rounded-sm bg-muted" />
              <div className="h-3 w-12 animate-pulse rounded-sm bg-muted" />
            </div>
            <div className="mt-1.5 h-2.5 w-4/5 animate-pulse rounded-sm bg-muted" />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Shared chrome: the frame and the count header every state keeps. */
function InventoryShell({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section data-testid="inventory-panel" className="pixel-frame bg-card">
      <header className="flex items-center justify-between px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Inventory</h2>
        <span className="pixel-numeral text-[10px] text-muted-foreground">{count}</span>
      </header>
      {children}
    </section>
  )
}

function ItemRow({
  item,
  writing,
  actions,
}: {
  item: RecordData<InventoryRow>
  writing: boolean
  actions?: ReactNode
}) {
  return (
    <li className="border-t border-border px-3 py-2 first:border-t-0" aria-busy={writing || undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-foreground">{item.data.itemName}</span>
        <Badge variant="outline" className="font-pixel text-[10px] uppercase">
          {item.data.category}
        </Badge>
        <span className="pixel-numeral text-xs text-muted-foreground">x{item.data.quantity}</span>
      </div>
      {item.data.description && (
        <p className="mt-1 text-xs text-muted-foreground">{item.data.description}</p>
      )}
      {actions}
    </li>
  )
}

/** `Use` only exists for consumables; `Discard` for anything carried. */
function ItemActions({
  item,
  ready,
  busy,
  writing,
  onUse,
  onDiscard,
}: {
  item: RecordData<InventoryRow>
  ready: boolean
  busy: boolean
  writing: boolean
  onUse: () => void
  onDiscard: () => void
}) {
  const consumable = item.data.category === 'consumable'
  return (
    <div className="mt-1.5 flex gap-1">
      {consumable && (
        <Button
          data-testid="inventory-use"
          size="sm"
          variant="outline"
          className="h-7 px-2 font-pixel text-[10px] uppercase"
          disabled={!ready || busy}
          loading={writing}
          onClick={onUse}
        >
          Use
        </Button>
      )}
      <Button
        data-testid="inventory-discard"
        size="sm"
        variant="ghost"
        className="h-7 px-2 font-pixel text-[10px] uppercase text-muted-foreground"
        disabled={!ready || busy}
        onClick={onDiscard}
      >
        Discard
      </Button>
    </div>
  )
}
