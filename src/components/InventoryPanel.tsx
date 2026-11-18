/**
 * Inventory panel — read-only list of what the character is carrying.
 * Presentational (`P1.10`); Use/Discard, quantity edits and the writes behind
 * them are `P3.6`'s, so there is deliberately no action surface here.
 */

import { Backpack } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import type { InventoryRow } from '@/lib/preview-data'

export function InventoryPanel({ items }: { items: InventoryRow[] }) {
  return (
    <section data-testid="inventory-panel" className="pixel-frame bg-card">
      <header className="flex items-center justify-between px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Inventory</h2>
        <span className="pixel-numeral text-[10px] text-muted-foreground">{items.length}</span>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<Backpack aria-hidden />}
          title="Nothing carried"
          description="Loot from the vault shows up here."
        />
      ) : (
        <ul className="mt-2 flex flex-col">
          {items.map((item, index) => (
            <li
              key={`${item.itemName}-${index}`}
              className="border-t border-border px-3 py-2 first:border-t-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-foreground">{item.itemName}</span>
                <Badge variant="outline" className="font-pixel text-[10px] uppercase">
                  {item.category}
                </Badge>
                <span className="pixel-numeral text-xs text-muted-foreground">x{item.quantity}</span>
              </div>
              {item.description && (
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
