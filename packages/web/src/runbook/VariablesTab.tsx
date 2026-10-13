import type { SessionApi } from '../session/useSession.js'
import { keyError, shadowedKeys } from '../session/vars.js'

interface Props {
  /** Frontmatter `env`, shown read-only so the operator sees the whole picture. */
  frontmatter: Record<string, string>
  params: Record<string, string>
  session: SessionApi
}

export function VariablesTab({ frontmatter, params, session }: Props) {
  const shadowed = shadowedKeys(frontmatter, session.env, params)
  const frontmatterKeys = Object.keys(frontmatter)

  return (
    <div className="stack">
      <p className="hint">
        This session only. Never written to the document, the recording or this browser — closing the tab forgets them,
        so a value here can safely be a token.
      </p>

      <div className="var-rows">
        {session.vars.map((variable, index) => {
          const error = keyError(
            variable.key,
            session.vars.slice(0, index).map((v) => v.key),
          )
          return (
            <div key={variable.id} className="var-row">
              <input
                className={`var-key ${error ? 'invalid' : ''}`}
                value={variable.key}
                placeholder="KEY"
                spellCheck={false}
                aria-label="Variable name"
                aria-invalid={Boolean(error)}
                onChange={(e) => session.update(variable.id, { key: e.target.value })}
              />
              <input
                className="var-value"
                type={variable.secret ? 'password' : 'text'}
                value={variable.value}
                placeholder="value"
                spellCheck={false}
                aria-label="Variable value"
                autoComplete={variable.secret ? 'new-password' : 'off'}
                onChange={(e) => session.update(variable.id, { value: e.target.value })}
              />
              <button
                className={variable.secret ? 'warn small' : 'ghost small'}
                aria-pressed={variable.secret}
                title="Mask the value and keep it out of the recording"
                onClick={() => session.update(variable.id, { secret: !variable.secret })}
              >
                secret
              </button>
              <button className="ghost small" aria-label={`Remove ${variable.key || 'row'}`} onClick={() => session.remove(variable.id)}>
                ✕
              </button>
              {error && <p className="error var-error">{error}</p>}
            </div>
          )
        })}
      </div>

      <div className="row">
        <button className="ghost small" onClick={session.add}>
          Add a variable
        </button>
        <span className="spacer" />
        <span className="meta">frontmatter env &lt; session variables &lt; parameters</span>
      </div>

      {frontmatterKeys.length > 0 && (
        <details className="from-runbook" open>
          <summary>
            from the runbook <span className="meta">env, read-only</span>
          </summary>
          <dl className="facts">
            {frontmatterKeys.map((key) => (
              <div key={key} className={`fact-pair ${shadowed.has(key) ? 'shadowed' : ''}`}>
                <dt>
                  <code>{key}</code>
                </dt>
                <dd>
                  <code>{frontmatter[key]}</code>
                  {shadowed.has(key) && <span className="chip stale">overridden</span>}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
