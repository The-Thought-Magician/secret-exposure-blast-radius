import { Hono } from 'hono'
import { db } from '../db/index.js'
import { secrets, resources, grant_edges } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Scoring weights — how much each reachable resource contributes to the
// blast-radius score, by sensitivity. Crown jewels dominate.
// ---------------------------------------------------------------------------
const SENSITIVITY_WEIGHT: Record<string, number> = {
  crown_jewel: 40,
  pii: 25,
  confidential: 15,
  internal: 6,
  public: 2,
}

const PERMISSION_MULTIPLIER: Record<string, number> = {
  admin: 1.5,
  write: 1.2,
  read: 1.0,
}

interface ReachableResource {
  resource_id: string
  name: string
  type: string | null
  sensitivity: string
  depth: number
  path: string[]
}

interface GraphNode {
  id: string
  label: string
  kind: string // 'secret' | 'resource'
  depth: number
  type: string | null
}
interface GraphEdge {
  from: string
  to: string
  permission: string
}

interface BlastResult {
  score: number
  reachable_count: number
  crown_jewel_count: number
  max_depth: number
  reachable_resources: ReachableResource[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

// ---------------------------------------------------------------------------
// computeBlastRadius — BFS from a starting secret over grant_edges, following
// transitive `contains_secret_id` hops (a reached resource that itself holds
// another secret expands that secret's grants too).
// ---------------------------------------------------------------------------
function computeBlastRadius(
  startSecretId: string,
  secretRows: Array<{ id: string; name: string }>,
  resourceRows: Array<{
    id: string
    name: string
    type: string
    sensitivity: string
    contains_secret_id: string | null
  }>,
  edgeRows: Array<{ secret_id: string; resource_id: string; permission: string }>,
): BlastResult {
  const secretById = new Map(secretRows.map((s) => [s.id, s]))
  const resourceById = new Map(resourceRows.map((r) => [r.id, r]))

  // secret_id -> outgoing grant edges
  const edgesBySecret = new Map<string, Array<{ resource_id: string; permission: string }>>()
  for (const e of edgeRows) {
    let list = edgesBySecret.get(e.secret_id)
    if (!list) {
      list = []
      edgesBySecret.set(e.secret_id, list)
    }
    list.push({ resource_id: e.resource_id, permission: e.permission })
  }

  const reachableResources = new Map<string, ReachableResource>()
  const graphNodes = new Map<string, GraphNode>()
  const graphEdges: GraphEdge[] = []
  const edgeSeen = new Set<string>()
  const visitedSecrets = new Set<string>()

  // BFS frontier holds secrets to expand, with the path that reached them.
  interface Frontier {
    secretId: string
    depth: number
    path: string[]
  }
  const queue: Frontier[] = []

  const startSecret = secretById.get(startSecretId)
  if (startSecret) {
    graphNodes.set(startSecretId, {
      id: startSecretId,
      label: startSecret.name,
      kind: 'secret',
      depth: 0,
      type: null,
    })
  }
  queue.push({ secretId: startSecretId, depth: 0, path: [startSecretId] })

  let maxDepth = 0

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visitedSecrets.has(cur.secretId)) continue
    visitedSecrets.add(cur.secretId)

    const outEdges = edgesBySecret.get(cur.secretId) ?? []
    for (const e of outEdges) {
      const resource = resourceById.get(e.resource_id)
      if (!resource) continue
      const resourceDepth = cur.depth + 1
      if (resourceDepth > maxDepth) maxDepth = resourceDepth

      // Register resource graph node.
      if (!graphNodes.has(resource.id)) {
        graphNodes.set(resource.id, {
          id: resource.id,
          label: resource.name,
          kind: 'resource',
          depth: resourceDepth,
          type: resource.type,
        })
      }
      // Register secret->resource edge (dedup).
      const edgeKey = `${cur.secretId}->${resource.id}`
      if (!edgeSeen.has(edgeKey)) {
        edgeSeen.add(edgeKey)
        graphEdges.push({ from: cur.secretId, to: resource.id, permission: e.permission })
      }

      // Record reachable resource at the shallowest depth seen.
      const existing = reachableResources.get(resource.id)
      const resourcePath = [...cur.path, resource.id]
      if (!existing || resourceDepth < existing.depth) {
        reachableResources.set(resource.id, {
          resource_id: resource.id,
          name: resource.name,
          type: resource.type,
          sensitivity: resource.sensitivity,
          depth: resourceDepth,
          path: resourcePath,
        })
      }

      // Transitive hop: resource holds another secret -> expand it.
      const nextSecretId = resource.contains_secret_id
      if (nextSecretId && !visitedSecrets.has(nextSecretId)) {
        const nextSecret = secretById.get(nextSecretId)
        if (nextSecret) {
          if (!graphNodes.has(nextSecretId)) {
            graphNodes.set(nextSecretId, {
              id: nextSecretId,
              label: nextSecret.name,
              kind: 'secret',
              depth: resourceDepth,
              type: null,
            })
          }
          // resource->contained secret edge.
          const containKey = `${resource.id}=>${nextSecretId}`
          if (!edgeSeen.has(containKey)) {
            edgeSeen.add(containKey)
            graphEdges.push({ from: resource.id, to: nextSecretId, permission: 'contains' })
          }
          queue.push({
            secretId: nextSecretId,
            depth: resourceDepth,
            path: [...resourcePath, nextSecretId],
          })
        }
      }
    }
  }

  // Score: sum over reachable resources of sensitivity-weight, discounted by
  // depth (deeper = slightly less direct), times the strongest permission
  // observed on its reaching edge.
  let score = 0
  let crownJewelCount = 0
  const reachableList = [...reachableResources.values()]
  // Build a per-resource best permission map from graph edges.
  const bestPermByResource = new Map<string, string>()
  for (const ge of graphEdges) {
    if (!resourceById.has(ge.to)) continue
    const cur = bestPermByResource.get(ge.to)
    const rank = (p: string) => (p === 'admin' ? 3 : p === 'write' ? 2 : 1)
    if (!cur || rank(ge.permission) > rank(cur)) bestPermByResource.set(ge.to, ge.permission)
  }
  for (const r of reachableList) {
    if (r.sensitivity === 'crown_jewel') crownJewelCount++
    const weight = SENSITIVITY_WEIGHT[r.sensitivity] ?? 5
    const perm = bestPermByResource.get(r.resource_id) ?? 'read'
    const permMult = PERMISSION_MULTIPLIER[perm] ?? 1
    const depthDiscount = 1 / (1 + 0.25 * Math.max(0, r.depth - 1))
    score += weight * permMult * depthDiscount
  }
  score = Math.round(score * 100) / 100

  reachableList.sort((a, b) => {
    const w = (SENSITIVITY_WEIGHT[b.sensitivity] ?? 5) - (SENSITIVITY_WEIGHT[a.sensitivity] ?? 5)
    if (w !== 0) return w
    return a.depth - b.depth
  })

  return {
    score,
    reachable_count: reachableList.length,
    crown_jewel_count: crownJewelCount,
    max_depth: maxDepth,
    reachable_resources: reachableList,
    graph: { nodes: [...graphNodes.values()], edges: graphEdges },
  }
}

// GET /:secretId — compute reachability for a single secret.
router.get('/:secretId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const secretId = c.req.param('secretId')

  const [secret] = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.user_id, userId)))
  if (!secret) return c.json({ error: 'Not found' }, 404)

  const [secretRows, resourceRows, edgeRows] = await Promise.all([
    db.select().from(secrets).where(eq(secrets.user_id, userId)),
    db.select().from(resources).where(eq(resources.user_id, userId)),
    db.select().from(grant_edges).where(eq(grant_edges.user_id, userId)),
  ])

  const result = computeBlastRadius(
    secretId,
    secretRows.map((s) => ({ id: s.id, name: s.name })),
    resourceRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      sensitivity: r.sensitivity,
      contains_secret_id: r.contains_secret_id,
    })),
    edgeRows.map((e) => ({
      secret_id: e.secret_id,
      resource_id: e.resource_id,
      permission: e.permission,
    })),
  )

  return c.json(result)
})

// GET / — blast-radius summary across all the caller's secrets.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const [secretRows, resourceRows, edgeRows] = await Promise.all([
    db.select().from(secrets).where(eq(secrets.user_id, userId)).orderBy(desc(secrets.created_at)),
    db.select().from(resources).where(eq(resources.user_id, userId)),
    db.select().from(grant_edges).where(eq(grant_edges.user_id, userId)),
  ])

  const secretRefs = secretRows.map((s) => ({ id: s.id, name: s.name }))
  const resourceRefs = resourceRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    sensitivity: r.sensitivity,
    contains_secret_id: r.contains_secret_id,
  }))
  const edgeRefs = edgeRows.map((e) => ({
    secret_id: e.secret_id,
    resource_id: e.resource_id,
    permission: e.permission,
  }))

  const summary = secretRows.map((s) => {
    const r = computeBlastRadius(s.id, secretRefs, resourceRefs, edgeRefs)
    return {
      secret_id: s.id,
      name: s.name,
      score: r.score,
      reachable_count: r.reachable_count,
      crown_jewel_count: r.crown_jewel_count,
      max_depth: r.max_depth,
    }
  })

  summary.sort((a, b) => b.score - a.score)
  return c.json({ secrets: summary })
})

export default router
