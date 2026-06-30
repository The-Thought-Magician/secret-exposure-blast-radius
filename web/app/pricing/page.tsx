'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Secret registry with grants, fingerprints, and lifecycle states',
  'Store inventory and copy tracking',
  'Resource catalog and grant-edge graph',
  'Blast-radius graph engine with transitive reachability',
  'Exposure declaration with auto-derived severity',
  'Timeline reconstruction from access logs',
  'Rotation runbook engine with copy-discovery',
  'Reuse detector and rotation-debt ledger',
  'Signed incident evidence records',
  'Tabletop simulator',
  'Dashboards, reports, and audit log',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const plan = await api.getBillingPlan()
        if (!cancelled) setStripeEnabled(Boolean(plan?.stripeEnabled))
      } catch {
        if (!cancelled) setStripeEnabled(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-black tracking-tight">
          SecretExposure<span className="text-red-500">BlastRadius</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-medium">Get Started</Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple pricing</h1>
        <p className="mt-4 text-zinc-400">Every feature is free for signed-in users. A Pro plan exists for future paid add-ons; billing is optional and not yet active.</p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="rounded-xl border border-red-900/60 bg-zinc-900/60 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Free</h2>
              <span className="rounded-full border border-red-900/60 bg-red-950/30 px-2 py-0.5 text-xs font-medium text-red-300">Current plan</span>
            </div>
            <div className="mt-4 text-4xl font-black">$0<span className="text-base font-normal text-zinc-500">/mo</span></div>
            <p className="mt-2 text-sm text-zinc-400">Everything SecretExposureBlastRadius does, at no cost.</p>
            <ul className="mt-6 space-y-2 text-sm text-zinc-300">
              {freeFeatures.map((f) => (
                <li key={f} className="flex gap-2"><span className="text-red-500">✓</span><span>{f}</span></li>
              ))}
            </ul>
            <Link href="/auth/sign-up" className="mt-8 block rounded-lg bg-red-600 hover:bg-red-500 px-4 py-3 text-center font-semibold text-white">
              Start free
            </Link>
          </div>

          {/* Pro plan */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-left">
            <h2 className="text-lg font-bold">Pro</h2>
            <div className="mt-4 text-4xl font-black text-zinc-300">Coming soon</div>
            <p className="mt-2 text-sm text-zinc-400">
              Future paid add-ons such as connected-store sync, SSO, and managed retention. Billing is wired and optional.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-zinc-400">
              <li className="flex gap-2"><span className="text-zinc-600">•</span><span>Everything in Free</span></li>
              <li className="flex gap-2"><span className="text-zinc-600">•</span><span>Connected secret-store sync</span></li>
              <li className="flex gap-2"><span className="text-zinc-600">•</span><span>SSO and extended retention</span></li>
            </ul>
            <button
              disabled
              className="mt-8 block w-full cursor-not-allowed rounded-lg border border-zinc-800 px-4 py-3 text-center font-semibold text-zinc-500"
            >
              {stripeEnabled ? 'Available soon' : 'Billing not yet enabled'}
            </button>
            <p className="mt-3 text-center text-xs text-zinc-600">
              {stripeEnabled === null
                ? ''
                : stripeEnabled
                  ? 'Billing is configured for this workspace.'
                  : 'Payments return 503 until Stripe is configured. All features remain free.'}
            </p>
          </div>
        </div>

        <p className="mt-12 text-sm text-zinc-500">
          No credit card required. <Link href="/" className="text-red-400 hover:text-red-300">Back to home</Link>
        </p>
      </section>
    </main>
  )
}
