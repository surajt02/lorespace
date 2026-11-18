/**
 * Party roster — the left column of the table: who is standing, and how badly
 * they are hurt. Prop-driven (`P1.10`); `P4.3` feeds it presence × characters,
 * which is why `online` is optional rather than derived here.
 *
 * Deliberately carries **no** nav user-name test id — `smoke.spec.ts` asserts
 * that id is absent while signed out, and party members are not the nav user.
 */

import { Users } from 'lucide-react'
import { Avatar, AvatarFallback, Badge, EmptyState } from '@/components/ui'

export interface RosterMember {
  id: string
  name: string
  archetype: string
  hp: number
  maxHp: number
  online?: boolean
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function PartyRoster({ members }: { members: RosterMember[] }) {
  return (
    <section data-testid="party-roster" className="flex flex-col gap-2">
      <header className="flex items-center justify-between px-3 pt-3">
        <h2 className="font-pixel text-[10px] uppercase text-muted-foreground">Party</h2>
        <span className="pixel-numeral text-[10px] text-muted-foreground">{members.length}</span>
      </header>

      {members.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden />}
          title="No one at the table"
          description="Adventurers appear here as they join the campaign."
        />
      ) : (
        <ul className="flex flex-col">
          {members.map((member) => {
            const hp = Math.min(Math.max(member.hp, 0), member.maxHp)
            return (
              <li
                key={member.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="pixel-numeral text-[10px]">
                    {initials(member.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm text-foreground">{member.name}</span>
                    <span
                      aria-hidden="true"
                      className={
                        member.online
                          ? 'size-1.5 shrink-0 rounded-full bg-success'
                          : 'size-1.5 shrink-0 rounded-full bg-muted-foreground'
                      }
                    />
                    <span className="sr-only">{member.online ? 'online' : 'offline'}</span>
                  </div>
                  <Badge variant="secondary" className="mt-1 font-pixel text-[10px] uppercase">
                    {member.archetype}
                  </Badge>
                </div>

                <span className="pixel-numeral text-xs text-foreground">
                  {hp}
                  <span className="text-muted-foreground">/{member.maxHp}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
