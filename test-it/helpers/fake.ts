import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'

export interface FakeAxiosHandlers {
  get?: (url: string) => Promise<any>
  post?: (url: string, body: any, config?: any) => Promise<any>
  patch?: (url: string, body: any) => Promise<any>
}

export const fakeAxios = (handlers: FakeAxiosHandlers = {}): ProcessingContext['axios'] => ({
  get: async (url: string) => ({ data: await handlers.get?.(url) }),
  post: async (url: string, body: any, config?: any) => ({ data: await handlers.post?.(url, body, config) }),
  patch: async (url: string, body: any) => ({ data: await handlers.patch?.(url, body) })
} as any)

export interface CapturedLog {
  level: string
  message: string
  extra?: unknown
}

export const fakeLog = (): { log: ProcessingContext['log'], logs: CapturedLog[] } => {
  const logs: CapturedLog[] = []
  const push = (level: string) => async (message: string, extra?: unknown) => { logs.push({ level, message, extra }) }
  const log = {
    step: push('step'),
    info: push('info'),
    warning: push('warning'),
    error: push('error'),
    debug: push('debug'),
    task: async () => {},
    progress: async () => {}
  }
  return { log: log as any, logs }
}

export interface FakeContextOptions {
  processingConfig: any
  axios?: ProcessingContext['axios']
}

export const fakeContext = (options: FakeContextOptions): {
  context: ProcessingContext<any>
  patches: any[]
  logs: CapturedLog[]
} => {
  const patches: any[] = []
  const { log, logs } = fakeLog()
  const context = {
    processingConfig: options.processingConfig,
    secrets: {},
    processingId: 'test-processing',
    tmpDir: '/tmp/opencode',
    log,
    axios: options.axios ?? fakeAxios(),
    patchConfig: async (patch: any) => {
      patches.push(patch)
      Object.assign(options.processingConfig, patch)
    }
  } as any
  return { context, patches, logs }
}

export const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export const textResponse = (text: string, contentType = 'text/csv', status = 200): Response =>
  new Response(text, { status, headers: { 'content-type': contentType } })

export const binaryResponse = (buffer: Buffer, contentType = 'application/octet-stream'): Response =>
  new Response(buffer, { headers: { 'content-type': contentType } })

/** Remplace fetch le temps d'un test, sans laisser de mock derrière soi. */
export const withFetch = async <T>(handler: (url: string) => Promise<Response> | Response, fn: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: any) => handler(String(input))) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}
