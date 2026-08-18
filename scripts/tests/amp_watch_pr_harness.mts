// Model-free lifecycle acceptance harness for the generated Amp plugin.
import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as realDelay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout

const pluginPath = process.argv[2]
const workspace = process.argv[3]
if (!pluginPath || !workspace) {
  throw new Error('usage: amp_watch_pr_harness.ts <plugin> <workspace>')
}

const root = mkdtempSync(join(tmpdir(), 'amp-watch-pr-harness-'))
const fakeBin = join(root, 'bin')
const scenarioFile = join(root, 'scenario.json')
mkdirSync(fakeBin)
process.env.PATH = `${fakeBin}:${process.env.PATH}`
process.env.HOME = join(root, 'home')
mkdirSync(process.env.HOME, { recursive: true })
process.env.PHX_WATCH_SCENARIO = scenarioFile
process.env.ELIXIR_PHOENIX_WATCH_PR_CREDENTIAL_DIR = join(root, 'credentials')
process.on('exit', () => rmSync(root, { recursive: true, force: true }))

writeFileSync(
  join(fakeBin, 'gh.mjs'),
  `import { readFileSync } from 'node:fs'
const scenario = JSON.parse(readFileSync(process.env.PHX_WATCH_SCENARIO, 'utf8'))
const args = process.argv.slice(2)
const fail = (message, code = 1) => { console.error(message); process.exit(code) }
if (args[0] === 'repo' && args[1] === 'view') {
  console.log(scenario.repo)
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'view') {
  const pr = scenario.prs[String(args[2])]
  if (!pr) fail('missing PR')
  if (pr.viewError) fail(pr.viewError)
  console.log(JSON.stringify({
    number: Number(args[2]), state: pr.state, isDraft: Boolean(pr.draft),
    headRefOid: pr.head, url: 'https://github.com/' + scenario.repo + '/pull/' + args[2],
  }))
  process.exit(0)
}
if (args[0] === 'pr' && args[1] === 'checks') {
  const pr = scenario.prs[String(args[2])]
  if (!pr) fail('missing PR')
  const required = args.includes('--required')
  if (required && pr.noRequired) fail("no required checks reported on the branch")
  if (!required && pr.noChecks) fail("no checks reported on the branch")
  console.log(JSON.stringify(required ? pr.requiredChecks : pr.allChecks))
  process.exit(0)
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const numberArg = args.find((arg) => arg.startsWith('number='))
  const pr = scenario.prs[String(numberArg?.split('=')[1])]
  if (!pr) fail('missing PR')
  console.log(JSON.stringify({ data: { repository: { pullRequest: {
    comments: { nodes: pr.comments },
    reviews: { nodes: pr.reviews },
    reviewThreads: {
      nodes: pr.threads, pageInfo: { hasNextPage: false, endCursor: null },
    },
  } } } }))
  process.exit(0)
}
fail('unsupported fake gh command: ' + args.join(' '))
`,
)
writeFileSync(
  join(fakeBin, 'gh'),
  `#!/bin/sh
exec node "$(dirname "$0")/gh.mjs" "$@"
`,
)
chmodSync(join(fakeBin, 'gh'), 0o755)

interface ScenarioPR {
  state: string
  draft?: boolean
  head: string
  requiredChecks: Array<Record<string, unknown>>
  allChecks: Array<Record<string, unknown>>
  threads: Array<Record<string, unknown>>
  comments: Array<Record<string, unknown>>
  reviews: Array<Record<string, unknown>>
  viewError?: string
  noRequired?: boolean
  noChecks?: boolean
}

const pass = (name: string, workflow = 'CI') => ({
  name,
  workflow,
  state: 'SUCCESS',
  bucket: 'pass',
  link: `https://checks.test/${name}`,
})
const pending = (name: string, workflow = 'CI') => ({
  name,
  workflow,
  state: 'PENDING',
  bucket: 'pending',
  link: `https://checks.test/${name}`,
})
const failure = (name: string, workflow = 'CI') => ({
  name,
  workflow,
  state: 'FAILURE',
  bucket: 'fail',
  link: `https://checks.test/${name}`,
})
const cancelled = (name: string, workflow = 'CI') => ({
  name,
  workflow,
  state: 'CANCELLED',
  bucket: 'cancel',
  link: `https://checks.test/${name}`,
})
const enaiaChecks = [
  'Static checks',
  'Design-system lifecycle',
  'check_gettext',
  'migration_check',
  'check_dialyzer',
  'test',
  'Integration tests',
  'Playwright E2E tests',
  'Codex PR Review',
  'All checks',
]
const deploymentChecks = [
  failure('deploy_branch', 'Release'),
  failure('deploy_staging', 'Release'),
  failure('draft_release', 'Release'),
  failure('tag_version', 'Release'),
]
const thread = (id: string, body = `finding ${id}`) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'lib/app.ex',
  line: 12,
  comments: {
    nodes: [{
      id: `comment-${id}`,
      url: `https://github.com/acme/app/pull/1#discussion_${id}`,
      body,
      createdAt: '2026-08-18T11:59:00Z',
      updatedAt: '2026-08-18T11:59:00Z',
      author: { login: 'reviewer' },
    }],
  },
})

const scenario: { repo: string; prs: Record<string, ScenarioPR> } = {
  repo: 'acme/app',
  prs: {
    '1': {
      state: 'OPEN',
      head: 'aaaaaaaaaaaaaaaa',
      requiredChecks: [pending(enaiaChecks[0]), ...enaiaChecks.slice(1).map(pass), ...deploymentChecks],
      allChecks: [pending(enaiaChecks[0]), ...enaiaChecks.slice(1).map(pass), ...deploymentChecks],
      threads: [],
      comments: [],
      reviews: [],
    },
    '2': {
      state: 'OPEN',
      head: 'bbbbbbbbbbbbbbbb',
      requiredChecks: [pass('unit')],
      allChecks: [pass('unit')],
      threads: [thread('thread-1')],
      comments: [],
      reviews: [],
    },
    '3': {
      state: 'OPEN',
      head: 'cccccccccccccccc',
      requiredChecks: [pending('unit')],
      allChecks: [pending('unit')],
      threads: [],
      comments: [],
      reviews: [],
    },
    '4': {
      state: 'OPEN',
      head: 'dddddddddddddddd',
      requiredChecks: [pending('unit')],
      allChecks: [pending('unit')],
      threads: [],
      comments: [],
      reviews: [],
    },
    '5': {
      state: 'OPEN',
      head: 'eeeeeeeeeeeeeeee',
      requiredChecks: [pending('unit')],
      allChecks: [pending('unit')],
      threads: [],
      comments: [],
      reviews: [],
    },
    '6': {
      state: 'OPEN',
      head: 'ffffffffffffffff',
      requiredChecks: [pending('unit')],
      allChecks: [pending('unit')],
      threads: [],
      comments: [],
      reviews: [],
    },
    '7': {
      state: 'OPEN',
      head: '7777777777777777',
      requiredChecks: [],
      allChecks: [],
      threads: [],
      comments: [],
      reviews: [],
      noRequired: true,
      noChecks: true,
    },
    '8': {
      state: 'OPEN',
      head: '8888888888888888',
      requiredChecks: [pass('unit'), failure('deploy_branch', 'Release')],
      allChecks: [pass('unit'), failure('deploy_branch', 'Release')],
      threads: [],
      comments: [],
      reviews: [],
    },
    '9': {
      state: 'OPEN',
      head: '9999999999999999',
      requiredChecks: [pending('unit')],
      allChecks: [pending('unit')],
      threads: [],
      comments: [],
      reviews: [],
    },
  },
}

function saveScenario(): void {
  writeFileSync(scenarioFile, JSON.stringify(scenario))
}
saveScenario()

let clock = Date.parse('2026-08-18T12:00:00Z')
let timerID = 0
interface FakeTimer {
  id: number
  fake: true
  unref(): FakeTimer
  ref(): FakeTimer
}
type TimerCallback = () => void | Promise<void>
const timers = new Map<FakeTimer, { at: number; callback: TimerCallback }>()
Date.now = () => clock
globalThis.setTimeout = ((callback: TimerCallback, delay = 0) => {
  if (Number(delay) === 12_000) return realSetTimeout(callback, delay)
  const timer: FakeTimer = {
    id: ++timerID,
    fake: true,
    unref() { return timer },
    ref() { return timer },
  }
  timers.set(timer, { at: clock + Number(delay), callback })
  return timer
}) as typeof setTimeout
globalThis.clearTimeout = ((timer: FakeTimer | Parameters<typeof realClearTimeout>[0]) => {
  if (typeof timer === 'object' && timer !== null && 'fake' in timer) {
    timers.delete(timer as FakeTimer)
    return
  }
  realClearTimeout(timer as Parameters<typeof realClearTimeout>[0])
}) as typeof clearTimeout

async function flush(): Promise<void> {
  await realDelay(80)
}

async function advance(milliseconds: number): Promise<void> {
  clock += milliseconds
  for (let round = 0; round < 20; round += 1) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= clock)
      .sort((left, right) => left[1].at - right[1].at)
    if (due.length === 0) break
    const callbacks: Array<void | Promise<void>> = []
    for (const [id, timer] of due) {
      timers.delete(id)
      callbacks.push(timer.callback())
    }
    await Promise.all(callbacks)
    await flush()
  }
  await flush()
}

async function eventually(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await realDelay(20)
  }
  assert.fail(message)
}

class FakeThread {
  id: `T-${string}`
  appended: string[] = []
  stateValue: 'idle' | 'running' | 'awaiting-approval' | 'error' = 'idle'
  holdResponses = false
  maxConcurrentTurns = 0
  activeTurns = 0
  private responseResolvers: Array<() => void> = []

  constructor(id: `T-${string}`) {
    this.id = id
  }

  state = {
    get: async () => this.stateValue,
  }

  async messages(options: { offset?: number; limit?: number }) {
    const offset = options.offset ?? 0
    const limit = options.limit ?? 20
    return this.appended
      .slice()
      .reverse()
      .slice(offset, offset + limit)
      .map((content, index) => ({
        role: 'user',
        id: `message-${offset + index}`,
        content: [{ type: 'text', text: content }],
      }))
  }

  async appendUserMessage(message: { content: string }) {
    this.appended.push(message.content)
    this.stateValue = 'running'
    this.activeTurns += 1
    this.maxConcurrentTurns = Math.max(this.maxConcurrentTurns, this.activeTurns)
    if (!this.holdResponses) this.releaseResponses()
  }

  async waitForResponse() {
    if (this.stateValue === 'idle') return { role: 'assistant', id: 'done', content: [] }
    return new Promise((resolve) => {
      this.responseResolvers.push(() => resolve({ role: 'assistant', id: 'done', content: [] }))
    })
  }

  releaseResponses(): void {
    this.stateValue = 'idle'
    this.activeTurns = 0
    for (const resolve of this.responseResolvers.splice(0)) resolve()
  }
}

interface Lease {
  released: boolean
  unsubscribe(): void
}

const { default: plugin } = await import(pathToFileURL(pluginPath).href)
let configuration: Record<string, unknown> = {}
const threads = new Map<string, FakeThread>()

function getThread(id: `T-${string}`): FakeThread {
  let value = threads.get(id)
  if (!value) {
    value = new FakeThread(id)
    threads.set(id, value)
  }
  return value
}

function setupPlugin() {
  const tools = new Map<string, any>()
  const leases: Lease[] = []
  const disposeCallbacks: Array<() => void | Promise<void>> = []
  let webhookHandler: Function | undefined
  const amp: any = {
    configuration: {
      async get() {
        return JSON.parse(JSON.stringify(configuration))
      },
      async update(partial: Record<string, unknown>) {
        configuration = { ...configuration, ...JSON.parse(JSON.stringify(partial)) }
      },
    },
    system: {
      workspaceRoot: workspace,
      executor: {
        async keepAlive() {
          const lease: Lease = {
            released: false,
            unsubscribe() {
              lease.released = true
            },
          }
          leases.push(lease)
          return lease
        },
      },
    },
    helpers: {
      filePathFromURI(value: string) {
        return value
      },
    },
    threads: {
      get(id: `T-${string}`) {
        return getThread(id)
      },
    },
    createWebhook(options: { handler: Function }) {
      webhookHandler = options.handler
      return Promise.resolve({ url: 'https://webhook.invalid/bearer-secret' })
    },
    registerTool(definition: any) {
      tools.set(definition.name, definition)
    },
    onDispose(callback: () => void | Promise<void>) {
      disposeCallbacks.push(callback)
      return { unsubscribe() {} }
    },
    logger: { log() {} },
  }
  plugin(amp)
  return { tools, leases, disposeCallbacks, get webhookHandler() { return webhookHandler } }
}

const first = setupPlugin()
await flush()
const tool = first.tools.get('elixir_phoenix_watch_pr')
assert.ok(tool, 'watch tool must register')

async function execute(
  runtime: ReturnType<typeof setupPlugin>,
  threadID: `T-${string}`,
  input: Record<string, unknown>,
): Promise<string> {
  return runtime.tools.get('elixir_phoenix_watch_pr').execute(input, {
    thread: getThread(threadID),
  })
}

// Pending required CI acquires a lease and remains awake beyond five minutes.
let output = await execute(first, 'T-main', {
  action: 'start',
  pr: '1',
  repo: 'acme/app',
})
assert.match(output, /Keep-alive lease acquired/)
assert.match(output, /Static checks=pending/)
assert.match(output, /Codex PR Review=pass/)
for (const check of deploymentChecks) assert.match(output, new RegExp(`${check.name}=fail`))
assert.match(output, /not evaluated/)
assert.match(output, /quiet 15m, max active duration 2h/)
assert.equal(first.leases.length, 1)
assert.equal(first.leases[0].released, false)
const initialMessages = getThread('T-main').appended.length
await advance(5 * 60_000 + 1_000)
assert.equal(first.leases[0].released, false, 'lease must survive Amp inactivity pause')
assert.equal(
  getThread('T-main').appended.length,
  initialMessages,
  'unchanged polls must not wake the model',
)

// A just-opened PR with no registered checks starts its stabilization lease
// instead of treating GitHub's expected "no checks" response as a poll error.
output = await execute(first, 'T-no-checks-yet', {
  action: 'start',
  pr: '7',
  repo: 'acme/app',
})
assert.match(output, /Required non-deployment checks: none configured/)
assert.doesNotMatch(output, /failed:/)
const noChecksLease = first.leases.at(-1)!
assert.equal(noChecksLease.released, false)
await execute(first, 'T-no-checks-yet', { action: 'stop', pr: '7', repo: 'acme/app' })
assert.equal(noChecksLease.released, true)

// Deployment-only transitions remain visible through explicit status, but they
// neither wake inference nor reset an otherwise-ready quiet window.
output = await execute(first, 'T-deployment-only', {
  action: 'start',
  pr: '8',
  repo: 'acme/app',
})
assert.match(output, /deploy_branch=fail/)
const deploymentLease = first.leases.at(-1)!
const deploymentThread = getThread('T-deployment-only')
await advance(5 * 60_000)
scenario.prs['8'].requiredChecks = [pass('unit'), pass('deploy_branch', 'Release')]
scenario.prs['8'].allChecks = [...scenario.prs['8'].requiredChecks]
saveScenario()
await advance(60_000)
assert.equal(deploymentThread.appended.length, 0, 'deployment transitions must stay silent')
output = await execute(first, 'T-deployment-only', {
  action: 'status',
  pr: '8',
  repo: 'acme/app',
})
assert.match(output, /deploy_branch=pass/, 'explicit status must report excluded transitions')
await advance(9 * 60_000)
await eventually(
  () => deploymentLease.released,
  'deployment-only activity must not restart the readiness quiet window',
)
assert.ok(deploymentThread.appended.some((message) =>
  message.includes('READY:') && message.includes('deploy_branch=pass'),
), 'the terminal summary must retain the latest excluded-check state')

// Head changes and routine required-CI progress reset lifecycle state but stay
// silent because they do not require an agent turn.
scenario.prs['1'].head = '1111111111111111'
scenario.prs['1'].requiredChecks = [...enaiaChecks.map(pass), ...deploymentChecks]
scenario.prs['1'].allChecks = [...scenario.prs['1'].requiredChecks]
saveScenario()
await advance(60_000)
assert.equal(getThread('T-main').appended.length, initialMessages)
const changedMessages = initialMessages
await advance(60_000)
assert.equal(getThread('T-main').appended.length, changedMessages)

// Early green plus zero threads is not ready: a silent-check account review can
// arrive later and must restart the 15-minute activity-based quiet window.
// One unchanged minute elapsed above, so advance thirteen more to reach minute 14.
await advance(13 * 60_000)
assert.equal(first.leases[0].released, false, 'early green must remain leased during quiet')
const accountReviewAt = new Date(clock).toISOString()
scenario.prs['1'].reviews = [{ id: 'account-review-1', submittedAt: accountReviewAt }]
saveScenario()
await advance(60_000)
assert.equal(
  getThread('T-main').appended.length,
  changedMessages,
  'review activity without actionable threads should reset quiet without inference',
)
await advance(14 * 60_000)
assert.equal(first.leases[0].released, false, 'review activity must restart quiet')
const reviewMessageCount = getThread('T-main').appended.length
scenario.prs['1'].comments = [{
  id: 'top-level-comment-1',
  createdAt: accountReviewAt,
  updatedAt: accountReviewAt,
}]
saveScenario()
await advance(60_000)
assert.equal(
  first.leases[0].released,
  false,
  'a new comment must restart quiet even when its timestamp matches prior activity',
)
assert.equal(
  getThread('T-main').appended.length,
  reviewMessageCount,
  'a non-actionable same-timestamp comment must not wake inference',
)
await advance(15 * 60_000)
await eventually(() => first.leases[0].released, 'quiet success must release lease')
assert.ok(getThread('T-main').appended.some((message) => message.includes('READY:')))

// Without --fix, a newly failed required check wakes once with actionable names
// and links; unchanged failure polls and routine pending/pass states stay silent.
output = await execute(first, 'T-ci-report', {
  action: 'start',
  pr: '9',
  repo: 'acme/app',
})
const ciReportThread = getThread('T-ci-report')
assert.equal(ciReportThread.appended.length, 0)
scenario.prs['9'].requiredChecks = [failure('unit')]
scenario.prs['9'].allChecks = [...scenario.prs['9'].requiredChecks]
saveScenario()
await advance(60_000)
await eventually(
  () => ciReportThread.appended.some((message) =>
    message.includes('unit=fail') && message.includes('https://checks.test/unit')),
  'required CI failure should wake once with actionable evidence',
)
const ciFailureMessageCount = ciReportThread.appended.length
await advance(60_000)
assert.equal(ciReportThread.appended.length, ciFailureMessageCount)
await execute(first, 'T-ci-report', { action: 'stop', pr: '9', repo: 'acme/app' })

// A failed required check alone is sufficient to start a --fix turn. It carries
// safe repair authorization and remains deduplicated without review feedback.
const ciFixThread = getThread('T-ci-fix')
output = await execute(first, 'T-ci-fix', {
  action: 'start',
  pr: '9',
  repo: 'acme/app',
  fix: true,
})
const ciFixLease = first.leases.at(-1)!
await eventually(
  () => ciFixThread.appended.some((message) =>
    message.includes('required CI failures') &&
    message.includes('unit=fail') &&
    message.includes('pushes')),
  'failed required CI alone should queue an authorized fix turn',
)
const ciFixMessageCount = ciFixThread.appended.length
await advance(60_000)
assert.equal(ciFixThread.appended.length, ciFixMessageCount)
scenario.prs['9'].requiredChecks = [pass('unit')]
scenario.prs['9'].allChecks = [...scenario.prs['9'].requiredChecks]
saveScenario()
await advance(60_000)
assert.equal(ciFixThread.appended.length, ciFixMessageCount)
await execute(first, 'T-ci-fix', { action: 'stop', pr: '9', repo: 'acme/app' })
assert.equal(ciFixLease.released, true)

// --fix serializes review and required-CI fix turns without duplicating while
// one turn runs.
const fixThread = getThread('T-fix')
fixThread.holdResponses = true
output = await execute(first, 'T-fix', {
  action: 'start',
  pr: '2',
  repo: 'acme/app',
  fix: true,
})
const fixLease = first.leases.at(-1)!
assert.match(output, /Unresolved actionable review threads: 1/)
await eventually(
  () => fixThread.appended.some((message) => message.includes('phx-pr-review workflow')),
  'fix watch should append a PR-review turn',
)
const firstFixCount = fixThread.appended.length
scenario.prs['2'].threads = [thread('thread-2', 'new finding')]
scenario.prs['2'].requiredChecks = [failure('unit'), cancelled('Integration tests')]
scenario.prs['2'].allChecks = [...scenario.prs['2'].requiredChecks]
saveScenario()
await advance(60_000)
assert.equal(fixThread.appended.length, firstFixCount, 'fix turns must serialize')
assert.equal(fixThread.maxConcurrentTurns, 1)
fixThread.releaseResponses()
await flush()
await advance(0)
await eventually(
  () => fixThread.appended.length > firstFixCount,
  'new review and CI evidence should run after the first fix turn settles',
)
const combinedFixMessage = fixThread.appended.at(-1)!
assert.match(combinedFixMessage, /required CI failures/)
assert.match(combinedFixMessage, /unit=fail — https:\/\/checks\.test\/unit/)
assert.match(combinedFixMessage, /Integration tests=cancel/)
assert.match(combinedFixMessage, /fix only branch-owned causes/)
assert.match(combinedFixMessage, /Do not blindly rerun shared CI/)
scenario.prs['2'].threads = []
scenario.prs['2'].requiredChecks = [pass('unit'), pass('Integration tests')]
scenario.prs['2'].allChecks = [...scenario.prs['2'].requiredChecks]
saveScenario()
fixThread.releaseResponses()
await advance(60_000)
assert.equal(
  fixThread.appended.length,
  firstFixCount + 1,
  'resolved feedback and passing CI should not wake another fix turn',
)
await advance(15 * 60_000)
await eventually(
  () => fixLease.released,
  'resolved comments and green CI should release the fix watch after quiet period',
)

// Plugin disposal releases process leases; reload recovers active durable state once.
await execute(first, 'T-reload', {
  action: 'start',
  pr: '3',
  repo: 'acme/app',
})
const reloadLease = first.leases.at(-1)!
assert.equal(reloadLease.released, false)
for (const dispose of first.disposeCallbacks) await dispose()
assert.equal(reloadLease.released, true)
const second = setupPlugin()
await flush()
await eventually(
  () => second.leases.length === 1,
  'reload should reacquire one lease for persisted active state',
)
assert.equal(second.leases[0].released, false)
output = await execute(second, 'T-reload', { action: 'stop', pr: '3', repo: 'acme/app' })
assert.match(output, /released every keep-alive lease/)
assert.equal(second.leases[0].released, true)

// Five polling errors, a closed PR, and hard timeout all terminate incomplete and release.
await execute(second, 'T-error', { action: 'start', pr: '4', repo: 'acme/app' })
const errorLease = second.leases.at(-1)!
scenario.prs['4'].viewError = 'simulated GitHub outage'
saveScenario()
for (let attempt = 0; attempt < 5; attempt += 1) await advance(60_000)
await eventually(() => errorLease.released, 'error terminal path must release')
assert.ok(getThread('T-error').appended.some((message) => message.includes('INCOMPLETE (error)')))

await execute(second, 'T-closed', { action: 'start', pr: '5', repo: 'acme/app' })
const closedLease = second.leases.at(-1)!
scenario.prs['5'].state = 'CLOSED'
saveScenario()
await advance(60_000)
await eventually(() => closedLease.released, 'closed terminal path must release')
assert.ok(getThread('T-closed').appended.some((message) => message.includes('INCOMPLETE (closed)')))

await execute(second, 'T-timeout', {
  action: 'start',
  pr: '6',
  repo: 'acme/app',
  maxDurationHours: 0.5,
})
const timeoutLease = second.leases.at(-1)!
await advance(30 * 60_000)
await eventually(() => timeoutLease.released, 'timeout terminal path must release')
assert.ok(getThread('T-timeout').appended.some((message) => message.includes('INCOMPLETE (timed_out)')))

// Unscoped or unrelated status/check events cannot reactivate a succeeded watch
// or schedule a poll.
const webhookContext = {
  signal: new AbortController().signal,
  logger: { log() {} },
}
const leasesBeforeUnrelatedWebhooks = second.leases.length
const timersBeforeUnrelatedWebhooks = timers.size
await second.webhookHandler!({
  id: 'unrelated-status',
  body: new TextEncoder().encode(JSON.stringify({
    repository: { full_name: 'acme/app' },
    sha: '0000000000000000',
  })),
  headers: { 'x-github-event': 'status' },
}, webhookContext)
await second.webhookHandler!({
  id: 'empty-check-suite',
  body: new TextEncoder().encode(JSON.stringify({
    repository: { full_name: 'acme/app' },
    check_suite: { pull_requests: [] },
  })),
  headers: { 'x-github-event': 'check_suite' },
}, webhookContext)
assert.equal(second.leases.length, leasesBeforeUnrelatedWebhooks)
assert.equal(timers.size, timersBeforeUnrelatedWebhooks)

// A durable webhook with the exact watched head SHA reactivates one successful
// watch, and duplicate delivery remains idempotent.
scenario.prs['1'].threads = [thread('thread-after-success')]
saveScenario()
const webhookEvent = {
  id: 'webhook-event-1',
  body: new TextEncoder().encode(JSON.stringify({
    repository: { full_name: 'acme/app' },
    sha: scenario.prs['1'].head,
  })),
  headers: { 'x-github-event': 'status' },
  payload: undefined,
  metadata: {},
  receivedAt: new Date(clock).toISOString(),
}
await second.webhookHandler!(webhookEvent, webhookContext)
const webhookLeaseCount = second.leases.length
await second.webhookHandler!(webhookEvent, webhookContext)
assert.equal(second.leases.length, webhookLeaseCount, 'duplicate webhook must not reacquire')
await advance(0)
await eventually(
  () => getThread('T-main').appended.some((message) => message.includes('thread-after-success')),
  'webhook should wake the original worker thread with authoritative evidence',
)

const credentialRoot = process.env.ELIXIR_PHOENIX_WATCH_PR_CREDENTIAL_DIR!
const credentialDirectory = join(credentialRoot, readdirSync(credentialRoot)[0])
const credentialFile = join(credentialDirectory, 'webhook-url')
assert.equal(statSync(credentialFile).mode & 0o777, 0o600)
assert.equal(readFileSync(credentialFile, 'utf8'), 'https://webhook.invalid/bearer-secret\n')

console.log('Amp phx-watch-pr lifecycle harness passed')
