// Same-origin relative calls to the Next.js proxy. The path after /api/proxy/
// maps 1:1 to the backend path after /api/v1/. The proxy injects X-User-Id.

type Params = Record<string, string | number | boolean | undefined | null>

function qs(params?: Params): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => http(path)
const post = (path: string, body?: unknown) =>
  http(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const put = (path: string, body?: unknown) =>
  http(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => http(path, { method: 'DELETE' })

const api = {
  // secrets
  getSecrets: (params?: Params) => get(`secrets${qs(params)}`),
  getSecret: (id: string) => get(`secrets/${id}`),
  createSecret: (body: unknown) => post('secrets', body),
  updateSecret: (id: string, body: unknown) => put(`secrets/${id}`, body),
  deleteSecret: (id: string) => del(`secrets/${id}`),
  rotateSecret: (id: string) => post(`secrets/${id}/rotate`),

  // stores
  getStores: () => get('stores'),
  getStore: (id: string) => get(`stores/${id}`),
  createStore: (body: unknown) => post('stores', body),
  updateStore: (id: string, body: unknown) => put(`stores/${id}`, body),
  deleteStore: (id: string) => del(`stores/${id}`),
  scanStore: (id: string) => post(`stores/${id}/scan`),

  // copies
  getCopies: (params?: Params) => get(`copies${qs(params)}`),
  createCopy: (body: unknown) => post('copies', body),
  deleteCopy: (id: string) => del(`copies/${id}`),
  discoverCopies: (secretId: string) => get(`copies/discover/${secretId}`),

  // resources
  getResources: (params?: Params) => get(`resources${qs(params)}`),
  getResource: (id: string) => get(`resources/${id}`),
  createResource: (body: unknown) => post('resources', body),
  updateResource: (id: string, body: unknown) => put(`resources/${id}`, body),
  deleteResource: (id: string) => del(`resources/${id}`),

  // grants
  getGrants: (params?: Params) => get(`grants${qs(params)}`),
  createGrant: (body: unknown) => post('grants', body),
  updateGrant: (id: string, body: unknown) => put(`grants/${id}`, body),
  deleteGrant: (id: string) => del(`grants/${id}`),

  // blast radius
  getBlastRadius: (secretId: string) => get(`blast-radius/${secretId}`),
  getBlastRadiusSummary: () => get('blast-radius'),

  // exposures
  getExposures: (params?: Params) => get(`exposures${qs(params)}`),
  getExposure: (id: string) => get(`exposures/${id}`),
  createExposure: (body: unknown) => post('exposures', body),
  updateExposure: (id: string, body: unknown) => put(`exposures/${id}`, body),
  containExposure: (id: string) => post(`exposures/${id}/contain`),
  closeExposure: (id: string) => post(`exposures/${id}/close`),
  deleteExposure: (id: string) => del(`exposures/${id}`),

  // timeline
  getTimeline: (exposureId: string) => get(`timeline/${exposureId}`),
  reconstructTimeline: (exposureId: string) => post(`timeline/${exposureId}/reconstruct`),
  addTimelineEvent: (exposureId: string, body: unknown) => post(`timeline/${exposureId}/event`, body),

  // access logs
  getAccessLogs: (params?: Params) => get(`access-logs${qs(params)}`),
  createAccessLog: (body: unknown) => post('access-logs', body),
  bulkAccessLogs: (body: unknown) => post('access-logs/bulk', body),
  deleteAccessLog: (id: string) => del(`access-logs/${id}`),

  // runbooks
  getRunbooks: (params?: Params) => get(`runbooks${qs(params)}`),
  getRunbook: (id: string) => get(`runbooks/${id}`),
  addRunbookTask: (id: string, body: unknown) => post(`runbooks/${id}/tasks`, body),
  updateRunbookTask: (taskId: string, body: unknown) => put(`runbooks/tasks/${taskId}`, body),
  deleteRunbookTask: (taskId: string) => del(`runbooks/tasks/${taskId}`),

  // reuse
  getReuseClusters: () => get('reuse'),
  getReuseCluster: (id: string) => get(`reuse/${id}`),
  recomputeReuse: () => post('reuse/recompute'),

  // policies
  getPolicies: () => get('policies'),
  createPolicy: (body: unknown) => post('policies', body),
  updatePolicy: (id: string, body: unknown) => put(`policies/${id}`, body),
  deletePolicy: (id: string) => del(`policies/${id}`),

  // debt
  getDebt: (params?: Params) => get(`debt${qs(params)}`),
  recomputeDebt: () => post('debt/recompute'),
  resolveDebt: (id: string) => put(`debt/${id}/resolve`),
  getDebtSummary: () => get('debt/summary'),

  // evidence
  getEvidenceRecords: () => get('evidence'),
  getEvidenceRecord: (id: string) => get(`evidence/${id}`),
  generateEvidence: (exposureId: string) => post(`evidence/generate/${exposureId}`),

  // simulations
  getSimulations: () => get('simulations'),
  getSimulation: (id: string) => get(`simulations/${id}`),
  createSimulation: (body: unknown) => post('simulations', body),
  scoreSimulation: (id: string, body: unknown) => post(`simulations/${id}/score`, body),
  deleteSimulation: (id: string) => del(`simulations/${id}`),

  // owners
  getOwners: () => get('owners'),
  getOwner: (id: string) => get(`owners/${id}`),
  createOwner: (body: unknown) => post('owners', body),
  updateOwner: (id: string, body: unknown) => put(`owners/${id}`, body),
  deleteOwner: (id: string) => del(`owners/${id}`),
  assignOwner: (body: unknown) => post('owners/assign', body),

  // notifications
  getNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => put(`notifications/${id}/read`),
  markAllNotificationsRead: () => put('notifications/read-all'),

  // dashboard
  getDashboard: () => get('dashboard'),

  // reports
  getExposureHistory: () => get('reports/exposure-history'),
  getDebtTrend: () => get('reports/debt-trend'),
  getCrownJewels: () => get('reports/crown-jewels'),
  getPostureReport: () => get('reports/posture'),

  // audit
  getAuditLog: (params?: Params) => get(`audit${qs(params)}`),

  // seed
  seedSampleData: () => post('seed'),
  clearData: () => del('seed'),

  // billing
  getBillingPlan: () => get('billing/plan'),
  createCheckout: () => post('billing/checkout'),
  openPortal: () => post('billing/portal'),
}

export default api
