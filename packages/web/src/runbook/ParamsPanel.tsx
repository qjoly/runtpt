import type { ParamSpec } from '@runtpt/core'
import type { Runner } from './useRunner.js'

function Field({ spec, runner }: { spec: ParamSpec; runner: Runner }) {
  const value = runner.params[spec.name] ?? ''
  const id = `param-${spec.name}`
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {spec.prompt ?? spec.name}
        <code>{spec.name}</code>
        {spec.secret && <span className="chip warn">secret</span>}
        {spec.required && <span className="chip">required</span>}
      </span>
      {spec.options ? (
        <select id={id} value={value} onChange={(e) => runner.setParam(spec.name, e.target.value)}>
          <option value="">—</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={spec.secret ? 'password' : 'text'}
          value={value}
          autoComplete={spec.secret ? 'new-password' : 'off'}
          placeholder={spec.default ?? ''}
          onChange={(e) => runner.setParam(spec.name, e.target.value)}
        />
      )}
    </label>
  )
}

export function ParamsTab({ specs, runner }: { specs: ParamSpec[]; runner: Runner }) {
  return (
    <div className="stack">
      <p className="hint">
        Values are substituted into <code>{'{{ NAME }}'}</code> placeholders and exported to cells as environment
        variables. Secrets are registered with the agent and redacted from the <code>.runtpt</code>.
      </p>
      <div className="fields">
        {specs.map((spec) => (
          <Field key={spec.name} spec={spec} runner={runner} />
        ))}
      </div>
      {runner.missingParams.length > 0 && <p className="error">Still missing: {runner.missingParams.join(', ')}</p>}
    </div>
  )
}
