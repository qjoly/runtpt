/**
 * GitHub tokens never leave the browser: Device Flow talks to github.com (or to
 * the optional token-exchange endpoint, which only ever sees the device code),
 * and everything else goes straight to api.github.com.
 */

const TOKEN_KEY = 'runtpt.gh.token'

export const CLIENT_ID: string = import.meta.env.VITE_GITHUB_CLIENT_ID ?? ''
/** Optional stateless proxy for the Device Flow, which GitHub does not CORS-enable. */
export const TOKEN_PROXY: string = import.meta.env.VITE_GITHUB_PROXY ?? ''

export const SCOPES = 'repo read:user'

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export class DeviceFlowUnavailable extends Error {
  constructor(cause: string) {
    super(
      'GitHub Device Flow is not reachable from the browser (' +
        cause +
        '). Use a personal access token instead.',
    )
    this.name = 'DeviceFlowUnavailable'
  }
}

const deviceCodeUrl = (): string =>
  TOKEN_PROXY ? `${TOKEN_PROXY.replace(/\/$/, '')}/device/code` : 'https://github.com/login/device/code'

const deviceTokenUrl = (): string =>
  TOKEN_PROXY ? `${TOKEN_PROXY.replace(/\/$/, '')}/device/token` : 'https://github.com/login/oauth/access_token'

export async function requestDeviceCode(): Promise<DeviceCode> {
  if (!CLIENT_ID && !TOKEN_PROXY) throw new DeviceFlowUnavailable('no client id configured')
  let response: Response
  try {
    response = await fetch(deviceCodeUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
    })
  } catch (err) {
    throw new DeviceFlowUnavailable((err as Error).message || 'blocked by CORS')
  }
  if (!response.ok) throw new DeviceFlowUnavailable(`HTTP ${response.status}`)
  return (await response.json()) as DeviceCode
}

export interface PollOutcome {
  status: 'pending' | 'slow_down' | 'ok' | 'error'
  token?: string
  message?: string
  interval?: number
}

export async function pollDeviceToken(deviceCode: string): Promise<PollOutcome> {
  let response: Response
  try {
    response = await fetch(deviceTokenUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
  } catch (err) {
    return { status: 'error', message: (err as Error).message }
  }
  const body = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
    interval?: number
  }
  if (body.access_token) return { status: 'ok', token: body.access_token }
  if (body.error === 'authorization_pending') return { status: 'pending' }
  if (body.error === 'slow_down') return { status: 'slow_down', ...(body.interval ? { interval: body.interval } : {}) }
  return { status: 'error', message: body.error_description ?? body.error ?? 'Unknown error' }
}

export function loadStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function storeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
