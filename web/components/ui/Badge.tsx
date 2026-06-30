import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'red' | 'amber' | 'green' | 'blue' | 'zinc' | 'purple'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  red: 'bg-red-950/50 text-red-300 border-red-900/60',
  amber: 'bg-amber-950/50 text-amber-300 border-amber-900/60',
  green: 'bg-emerald-950/50 text-emerald-300 border-emerald-900/60',
  blue: 'bg-sky-950/50 text-sky-300 border-sky-900/60',
  purple: 'bg-violet-950/50 text-violet-300 border-violet-900/60',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

// Convenience: map common severity/status strings to a tone.
export function severityTone(value?: string): Tone {
  switch ((value ?? '').toLowerCase()) {
    case 'critical':
    case 'compromised':
    case 'high':
      return 'red'
    case 'medium':
    case 'rotating':
    case 'analyzing':
      return 'amber'
    case 'low':
    case 'contained':
    case 'closed':
    case 'active':
    case 'resolved':
    case 'verified':
    case 'done':
      return 'green'
    case 'detected':
      return 'blue'
    default:
      return 'zinc'
  }
}

export default Badge
