import Link from 'next/link'

const features = [
  {
    title: 'Blast-Radius Graph Engine',
    body: 'Enter the leaked secret. Get the full reachability set: direct grants plus transitive chains through store-contained secrets. Weighted score, explainable paths.',
  },
  {
    title: 'Exposure Timeline Reconstruction',
    body: 'Builds the who-could-have-used-it window from exposed-since to detected-at. Pulls access-log entries per reachable resource. Flags anomalous access.',
  },
  {
    title: 'Rotation Runbook Engine',
    body: 'Generates a runbook from the blast radius. One task per copy, store, and dependent credential. Does not close until every task is verified.',
  },
  {
    title: 'Copy Discovery',
    body: 'Finds every live copy across stores and reuse clusters before you call it contained. Gap report for copies with no rotation task.',
  },
  {
    title: 'Reuse Detector',
    body: 'Finds secrets that share a fingerprint across services and stores. One leak is N leaks when the secret is reused. This catches that.',
  },
  {
    title: 'Signed Incident Evidence',
    body: 'Content-hashed evidence record per closed exposure. Mean-time-to-contain and a completeness attestation. For your insurer, not for a Slack thread.',
  },
  {
    title: 'Rotation-Debt Ledger',
    body: 'Tracks standing risk: secrets past max age, never rotated, or sitting in a store that still holds a pre-rotation copy. Scored per owner.',
  },
  {
    title: 'Tabletop Simulator',
    body: 'Run a fake exposure before the real one hits. Sandbox blast radius, practice runbook, scored time-to-contain.',
  },
  {
    title: 'Posture & Reports',
    body: 'Open exposures, containment progress, crown-jewel exposure, reuse risk, insurer-renewal posture. One dashboard.',
  },
]

const questions = [
  {
    n: '01',
    q: 'What can this secret touch?',
    a: 'A reachability graph of every resource, service, dataset, and downstream credential it unlocks. Not a guess assembled by hand at 2am.',
  },
  {
    n: '02',
    q: 'Who could have used it, and when?',
    a: 'Exposure window and access timeline, built from logs across the reachable set. Anomalous access flagged.',
  },
  {
    n: '03',
    q: 'Is it actually rotated everywhere?',
    a: 'A runbook that will not close until every copy is proven rotated. Then signed proof of containment.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-black tracking-tight">
          SecretExposure<span className="text-pink-500">BlastRadius</span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/pricing" className="text-zinc-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="bg-pink-600 hover:bg-pink-500 text-white px-4 py-2 rounded-lg font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-pink-900/60 bg-pink-950/30 px-3 py-1 text-xs font-medium text-pink-300">
          Post-leak incident response
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-black tracking-tight leading-tight">
          A secret leaked. Find its
          <span className="text-pink-500"> blast radius</span> now.
        </h1>
        <p className="mt-6 max-w-2xl mx-auto text-lg text-zinc-400">
          Feed in the exposed credential. Get everything it can reach, the access timeline, and a rotation
          runbook that does not close until it is actually done. Insurer-grade evidence at the end.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="bg-pink-600 hover:bg-pink-500 text-white px-6 py-3 rounded-lg font-semibold">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="border border-zinc-700 hover:border-zinc-500 text-zinc-200 px-6 py-3 rounded-lg font-semibold">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-zinc-600">Free for signed-in users. Sample data included.</p>
      </section>

      {/* The three 2am questions */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-center text-2xl font-bold">Three questions. Answer them fast.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {questions.map((item) => (
              <div key={item.n} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
                <div className="text-3xl font-black text-pink-600/70">{item.n}</div>
                <h3 className="mt-3 text-lg font-semibold text-zinc-100">{item.q}</h3>
                <p className="mt-2 text-sm text-zinc-400">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold">Right now, response is chaos. Stop guessing.</h2>
        <ul className="mt-8 space-y-4 text-zinc-400">
          <li className="flex gap-3"><span className="text-pink-500">▸</span><span><span className="text-zinc-200 font-medium">Triage is guesswork.</span> No one has an authoritative map of what a given key, password, or token actually grants.</span></li>
          <li className="flex gap-3"><span className="text-pink-500">▸</span><span><span className="text-zinc-200 font-medium">Rotation is incomplete.</span> A stale copy sits in a CI variable, a Terraform state file, a teammate&apos;s .env. Partial rotation causes re-breach.</span></li>
          <li className="flex gap-3"><span className="text-pink-500">▸</span><span><span className="text-zinc-200 font-medium">No containment evidence.</span> Insurer asks for proof, you have Slack threads and memory. Not a signed timeline.</span></li>
          <li className="flex gap-3"><span className="text-pink-500">▸</span><span><span className="text-zinc-200 font-medium">Reuse multiplies blast radius.</span> Same secret, reused across services. One leak becomes N leaks.</span></li>
        </ul>
      </section>

      {/* Feature grid */}
      <section className="border-t border-zinc-800 bg-zinc-900/30">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-center text-2xl font-bold">Registry to graph to proof. Deterministic.</h2>
          <p className="mt-3 text-center text-zinc-400">Secret registry, blast-radius graph, rotation-to-proof, signed evidence.</p>
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
        <h2 className="text-2xl font-bold">Your insurer wants proof. Here it is.</h2>
        <p className="mt-4 text-zinc-400">
          Every closed exposure produces a containment timeline with mean-time-to-contain and a completeness
          attestation, content-hashed for tamper evidence. What your carrier needs to pay a claim and your SOC2
          auditor needs to close a finding. Generated, not reconstructed from memory.
        </p>
        <div className="mt-8">
          <Link href="/auth/sign-up" className="bg-pink-600 hover:bg-pink-500 text-white px-6 py-3 rounded-lg font-semibold">
            Contain your first exposure
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-10 text-center text-sm text-zinc-600">
        <p className="font-bold text-zinc-400">SecretExposure<span className="text-pink-500">BlastRadius</span></p>
        <p className="mt-2">Blast radius, rotation-to-proof, and evidence. Post-leak.</p>
      </footer>
    </main>
  )
}
