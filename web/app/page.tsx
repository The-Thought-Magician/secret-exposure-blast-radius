import Link from 'next/link'

const features = [
  {
    title: 'Blast-Radius Graph Engine',
    body: 'Given a leaked secret, compute the full reachability set: direct grants plus transitive chains via store-contained secrets, with a weighted score and explainable paths.',
  },
  {
    title: 'Exposure Timeline Reconstruction',
    body: 'Build the who-could-have-used-it window from exposed-since to detected-at, pulling access-log entries per reachable resource and flagging anomalous access.',
  },
  {
    title: 'Rotation Runbook Engine',
    body: 'Auto-generate a runbook from the blast radius: one task per copy, store, and dependent credential. It cannot reach complete until every task is verified.',
  },
  {
    title: 'Copy Discovery',
    body: 'Enumerate every live copy across stores and reuse clusters before you declare containment, with a gap report for copies that have no rotation task.',
  },
  {
    title: 'Reuse Detector',
    body: 'Find secrets that share a fingerprint across services and stores. One leak is really N leaks, and reuse expands the blast radius automatically.',
  },
  {
    title: 'Signed Incident Evidence',
    body: 'Generate an immutable, content-hashed evidence record per closed exposure with mean-time-to-contain and a completeness attestation for your cyber-insurer.',
  },
  {
    title: 'Rotation-Debt Ledger',
    body: 'Track standing risk: past-max-age secrets, never-rotated credentials, and stores holding pre-rotation copies, scored and broken down per owner.',
  },
  {
    title: 'Tabletop Simulator',
    body: 'Practice an exposure without a real leak. Generate a sandbox blast radius and practice runbook, then score the response on time-to-contain.',
  },
  {
    title: 'Posture & Reports',
    body: 'Open exposures, containment progress, crown-jewel exposure, reuse risk, and an insurer-renewal posture report, all in one dashboard.',
  },
]

const questions = [
  {
    n: '01',
    q: 'What can this secret touch?',
    a: 'A full reachability graph of every resource, service, dataset, and downstream credential the leaked secret unlocks, not a guess reconstructed by hand under stress.',
  },
  {
    n: '02',
    q: 'Who could have used it, and when?',
    a: 'A reconstructed exposure window and realistic access timeline built from access logs across the reachable set, with anomalous access flagged.',
  },
  {
    n: '03',
    q: 'Is it actually rotated everywhere?',
    a: 'A rotation runbook with copy-discovery and owner assignment that cannot be closed until every copy is proven rotated, plus signed proof of containment.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-black tracking-tight">
          SecretExposure<span className="text-red-500">BlastRadius</span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/pricing" className="text-zinc-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-red-900/60 bg-red-950/30 px-3 py-1 text-xs font-medium text-red-300">
          Post-leak incident response
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight leading-tight">
          When a credential leaks, know its
          <span className="text-red-500"> blast radius</span> in seconds.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-zinc-400">
          The moment a secret is exposed, SecretExposureBlastRadius computes everything it could touch,
          reconstructs the access timeline, and drives rotation to completion with insurer-grade proof of containment.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-lg font-semibold">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-6 py-3 rounded-lg font-semibold">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-zinc-600">All features free for signed-in users. Sample-data seeder built in.</p>
      </section>

      {/* The three 2am questions */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-center text-2xl font-bold">The three questions that matter at 2am</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {questions.map((item) => (
              <div key={item.n} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
                <div className="text-3xl font-black text-red-600/70">{item.n}</div>
                <h3 className="mt-3 text-lg font-semibold text-zinc-100">{item.q}</h3>
                <p className="mt-2 text-sm text-zinc-400">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold">Today, the response is chaos</h2>
        <ul className="mt-8 space-y-4 text-zinc-400">
          <li className="flex gap-3"><span className="text-red-500">▸</span><span><span className="text-zinc-200 font-medium">Triage is guesswork.</span> Nobody has an authoritative map of what a given key, password, or token actually grants.</span></li>
          <li className="flex gap-3"><span className="text-red-500">▸</span><span><span className="text-zinc-200 font-medium">Rotation is incomplete.</span> A stale copy lives on in a CI variable, a Terraform state file, a teammate&apos;s .env. Partial rotation is the #1 cause of re-breach.</span></li>
          <li className="flex gap-3"><span className="text-red-500">▸</span><span><span className="text-zinc-200 font-medium">There is no containment evidence.</span> When the insurer asks for proof, teams have Slack threads and memory, not a signed timeline.</span></li>
          <li className="flex gap-3"><span className="text-red-500">▸</span><span><span className="text-zinc-200 font-medium">Reuse multiplies blast radius.</span> The same secret is reused across services, so a single leak is actually N leaks.</span></li>
        </ul>
      </section>

      {/* Feature grid */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-center text-2xl font-bold">A deterministic, auditable containment workflow</h2>
          <p className="mt-3 text-center text-zinc-400">Secret registry to blast-radius graph to rotation-to-proof to signed evidence.</p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
                <h3 className="text-base font-semibold text-zinc-100">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Insurer-evidence pitch */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl font-bold">The deliverable cyber-insurers require</h2>
        <p className="mt-4 text-zinc-400">
          Every closed exposure produces a documented containment timeline with mean-time-to-contain and a completeness
          attestation, content-hashed for tamper evidence. The proof your carrier needs to pay a breach claim and your
          SOC2 auditor needs to close a finding, generated automatically instead of reconstructed from memory.
        </p>
        <div className="mt-8">
          <Link href="/auth/sign-up" className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-lg font-semibold">
            Contain your first exposure
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-10 text-center text-sm text-zinc-600">
        <p className="font-bold text-zinc-400">SecretExposure<span className="text-red-500">BlastRadius</span></p>
        <p className="mt-2">Post-leak blast radius, rotation-to-proof, and insurer-grade evidence.</p>
      </footer>
    </main>
  )
}
