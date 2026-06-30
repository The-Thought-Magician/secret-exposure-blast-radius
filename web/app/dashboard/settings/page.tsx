'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, severityTone } from '@/components/ui/Badge'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string
  current_period_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}

interface BillingPlan {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function fmtPrice(cents?: number) {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(0)}/mo`
}

export default function SettingsPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)

  const [confirmClear, setConfirmClear] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)

  useEffect(() => {
    let active = true
    authClient
      .getSession()
      .then((session) => {
        if (!active) return
        if (!session?.data) {
          router.replace('/auth/sign-in')
          return
        }
        const data = session.data as { user?: { email?: string; name?: string } }
        setUserEmail(data.user?.email ?? data.user?.name ?? null)
        setAuthed(true)
      })
      .catch(() => {
        if (active) router.replace('/auth/sign-in')
      })
    return () => {
      active = false
    }
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getBillingPlan()
      setBilling(data ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authed) load()
  }, [authed, load])

  async function startCheckout() {
    setCheckoutBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.createCheckout()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setNotice('Checkout session created but no redirect URL was returned.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout is unavailable. Stripe may not be configured.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  async function manageBilling() {
    setPortalBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.openPortal()
      if (res?.url) {
        window.location.href = res.url
      } else {
        setNotice('Portal session created but no redirect URL was returned.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing portal is unavailable. Stripe may not be configured.')
    } finally {
      setPortalBusy(false)
    }
  }

  async function doClear() {
    setClearBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.clearData()
      setConfirmClear(false)
      setNotice('All of your data has been cleared.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clear data')
    } finally {
      setClearBusy(false)
    }
  }

  async function signOut() {
    setSignOutBusy(true)
    try {
      await authClient.signOut()
    } catch {
      // ignore; redirect regardless
    } finally {
      router.replace('/auth/sign-in')
    }
  }

  if (!authed) return <PageSpinner label="Authenticating..." />

  const sub = billing?.subscription
  const plan = billing?.plan
  const stripeEnabled = billing?.stripeEnabled ?? false
  const planId = (plan?.id ?? sub?.plan_id ?? 'free').toLowerCase()
  const isPro = planId === 'pro'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Manage your account, subscription, and workspace data.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Signed in as</div>
            <div className="text-sm font-medium text-zinc-200">{userEmail ?? 'Authenticated user'}</div>
          </div>
          <Button variant="secondary" onClick={signOut} disabled={signOutBusy}>
            {signOutBusy ? <Spinner label="Signing out..." /> : 'Sign out'}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Billing & plan</CardTitle>
          {!loading && (
            <Badge tone={stripeEnabled ? 'green' : 'zinc'}>{stripeEnabled ? 'Stripe enabled' : 'Stripe not configured'}</Badge>
          )}
        </CardHeader>
        <CardBody className="space-y-5">
          {loading ? (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Spinner label="Loading billing..." />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat
                  label="Current plan"
                  value={plan?.name ?? (isPro ? 'Pro' : 'Free')}
                  tone={isPro ? 'green' : 'default'}
                />
                <Stat label="Price" value={fmtPrice(plan?.price_cents ?? (isPro ? undefined : 0))} />
                <Stat
                  label="Status"
                  value={<Badge tone={severityTone(sub?.status)}>{sub?.status ?? 'active'}</Badge>}
                />
                <Stat label="Renews" value={fmtDate(sub?.current_period_end)} />
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                {isPro ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-zinc-400">
                      You are on the Pro plan. Manage your payment method, invoices, or cancellation in the Stripe portal.
                    </div>
                    <Button onClick={manageBilling} disabled={portalBusy || !stripeEnabled}>
                      {portalBusy ? <Spinner label="Opening..." /> : 'Manage billing'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-zinc-400">
                      Upgrade to Pro for unlimited secrets, full blast-radius history, and signed insurer-ready evidence
                      exports.
                    </div>
                    <Button onClick={startCheckout} disabled={checkoutBusy || !stripeEnabled}>
                      {checkoutBusy ? <Spinner label="Redirecting..." /> : 'Upgrade to Pro'}
                    </Button>
                  </div>
                )}
                {!stripeEnabled && (
                  <p className="mt-3 text-xs text-zinc-600">
                    Stripe is not configured for this deployment, so checkout and the billing portal are disabled.
                  </p>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card className="border-red-900/50">
        <CardHeader>
          <CardTitle className="text-red-300">Data management</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl text-sm text-zinc-400">
            Permanently delete all of your workspace data: secrets, stores, resources, grants, exposures, runbooks,
            timelines, evidence, and audit history. This cannot be undone.
          </div>
          <Button variant="danger" onClick={() => setConfirmClear(true)}>
            Clear all data
          </Button>
        </CardBody>
      </Card>

      <Modal
        open={confirmClear}
        onClose={() => (clearBusy ? undefined : setConfirmClear(false))}
        title="Clear all data?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmClear(false)} disabled={clearBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doClear} disabled={clearBusy}>
              {clearBusy ? <Spinner label="Clearing..." /> : 'Yes, delete everything'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">
          This will permanently remove every record in your workspace. Your account and subscription remain intact, but
          all secrets, exposures, and incident history will be erased. This action cannot be reversed.
        </p>
      </Modal>
    </div>
  )
}
