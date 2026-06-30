import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'red' | 'amber' | 'green' | 'blue' | 'zinc' | 'purple'
  className?: string
}

const valueTones = {
  default: 'text-zinc-100',
  red: 'text-red-400',
  amber: 'text-amber-400',
  green: 'text-emerald-400',
  blue: 'text-sky-400',
  zinc: 'text-zinc-300',
  purple: 'text-violet-400',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
