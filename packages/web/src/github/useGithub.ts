import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DeviceFlowUnavailable,
  loadStoredToken,
  pollDeviceToken,
  requestDeviceCode,
  storeToken,
  type DeviceCode,
} from './auth.js'
import { getUser, type GhUser } from './api.js'

export type GithubStatus = 'anonymous' | 'authorizing' | 'signed-in' | 'error'

export interface GithubApi {
  token: string | null
  user: GhUser | null
  status: GithubStatus
  error: string | null
  deviceCode: DeviceCode | null
  /** False once GitHub's device endpoint has proved unreachable from this origin. */
  deviceFlowPossible: boolean
  remember: boolean
  setRemember: (value: boolean) => void
  startDeviceFlow: () => Promise<void>
  signInWithToken: (token: string) => Promise<void>
  signOut: () => void
}

export function useGithub(): GithubApi {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<GhUser | null>(null)
  const [status, setStatus] = useState<GithubStatus>('anonymous')
  const [error, setError] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null)
  const [deviceFlowPossible, setDeviceFlowPossible] = useState(true)
  const [remember, setRemember] = useState(() => loadStoredToken() !== null)
  const polling = useRef<number | null>(null)

  const adopt = useCallback(
    async (next: string, persist: boolean) => {
      const profile = await getUser(next)
      setToken(next)
      setUser(profile)
      setStatus('signed-in')
      setError(null)
      if (persist) storeToken(next)
    },
    [],
  )

  useEffect(() => {
    const stored = loadStoredToken()
    if (!stored) return
    adopt(stored, true).catch(() => {
      storeToken(null)
      setError('The stored GitHub token is no longer valid.')
    })
  }, [adopt])

  useEffect(() => () => {
    if (polling.current !== null) window.clearInterval(polling.current)
  }, [])

  const startDeviceFlow = useCallback(async () => {
    setError(null)
    setStatus('authorizing')
    let code: DeviceCode
    try {
      code = await requestDeviceCode()
    } catch (err) {
      if (err instanceof DeviceFlowUnavailable) setDeviceFlowPossible(false)
      setStatus('anonymous')
      setError((err as Error).message)
      return
    }
    setDeviceCode(code)

    let interval = Math.max(code.interval, 5)
    const tick = async () => {
      const outcome = await pollDeviceToken(code.device_code)
      if (outcome.status === 'ok' && outcome.token) {
        if (polling.current !== null) window.clearInterval(polling.current)
        setDeviceCode(null)
        try {
          await adopt(outcome.token, remember)
        } catch (err) {
          setStatus('error')
          setError((err as Error).message)
        }
        return
      }
      if (outcome.status === 'slow_down') {
        interval = outcome.interval ?? interval + 5
        if (polling.current !== null) window.clearInterval(polling.current)
        polling.current = window.setInterval(() => void tick(), interval * 1000)
        return
      }
      if (outcome.status === 'error') {
        if (polling.current !== null) window.clearInterval(polling.current)
        setDeviceCode(null)
        setStatus('anonymous')
        setError(outcome.message ?? 'Authorization failed')
      }
    }
    polling.current = window.setInterval(() => void tick(), interval * 1000)
  }, [adopt, remember])

  const signInWithToken = useCallback(
    async (value: string) => {
      setStatus('authorizing')
      try {
        await adopt(value.trim(), remember)
      } catch (err) {
        setStatus('error')
        setError((err as Error).message)
      }
    },
    [adopt, remember],
  )

  const signOut = useCallback(() => {
    if (polling.current !== null) window.clearInterval(polling.current)
    storeToken(null)
    setToken(null)
    setUser(null)
    setDeviceCode(null)
    setStatus('anonymous')
  }, [])

  return {
    token,
    user,
    status,
    error,
    deviceCode,
    deviceFlowPossible,
    remember,
    setRemember: (value) => {
      setRemember(value)
      storeToken(value ? token : null)
    },
    startDeviceFlow,
    signInWithToken,
    signOut,
  }
}
