import { useState } from 'react'
import { CLIENT_ID, TOKEN_PROXY } from './auth.js'
import type { GithubApi } from './useGithub.js'

export function GithubSignIn({ github }: { github: GithubApi }) {
  const [pat, setPat] = useState('')
  const deviceFlowConfigured = Boolean(CLIENT_ID || TOKEN_PROXY)

  if (github.status === 'signed-in' && github.user) {
    return (
      <div className="row between">
        <span className="user">
          <img src={github.user.avatar_url} alt="" width={20} height={20} />
          {github.user.login}
        </span>
        <label className="check">
          <input
            type="checkbox"
            checked={github.remember}
            onChange={(e) => github.setRemember(e.target.checked)}
          />
          Remember on this device
        </label>
        <button className="ghost small" onClick={github.signOut}>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      {github.deviceCode ? (
        <div className="device-code">
          <p>
            Enter this code at{' '}
            <a href={github.deviceCode.verification_uri} target="_blank" rel="noreferrer">
              {github.deviceCode.verification_uri}
            </a>
          </p>
          <strong className="user-code">{github.deviceCode.user_code}</strong>
          <p className="hint">Waiting for the authorization to go through…</p>
        </div>
      ) : (
        <>
          {deviceFlowConfigured && github.deviceFlowPossible && (
            <button className="primary" onClick={() => void github.startDeviceFlow()}>
              Sign in with GitHub
            </button>
          )}
          {(!deviceFlowConfigured || !github.deviceFlowPossible) && (
            <p className="warn-box">
              {deviceFlowConfigured
                ? 'GitHub refused the Device Flow request from this origin (it sends no CORS headers). Deploy the token-exchange endpoint, or use a personal access token below.'
                : 'No OAuth client is configured for this deployment, so the Device Flow is unavailable. Use a personal access token below.'}
            </p>
          )}

          <label className="field">
            <span className="field-label">Personal access token</span>
            <input
              type="password"
              value={pat}
              placeholder="ghp_… or github_pat_… with repo and read:user"
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pat.trim()) void github.signInWithToken(pat)
              }}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={github.remember} onChange={(e) => github.setRemember(e.target.checked)} />
            Remember on this device (stores the token in localStorage)
          </label>
          <button className="primary" disabled={!pat.trim()} onClick={() => void github.signInWithToken(pat)}>
            Use this token
          </button>
          <p className="hint">The token stays in this browser and is only ever sent to api.github.com.</p>
        </>
      )}
      {github.error && <p className="error">{github.error}</p>}
    </div>
  )
}
