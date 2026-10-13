import type { ParamSpec } from '@runtpt/core'
import { Modal } from '../ui/Modal.js'
import type { Runner } from './useRunner.js'

interface Props {
  specs: ParamSpec[]
  runner: Runner
  onClose: () => void
  /** Confirming resumes whatever the operator was trying to run. */
  onConfirm: () => void
}

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

export function ParamsPanel({ specs, runner, onClose, onConfirm }: Props) {
  const blocked = runner.missingParams.length > 0
  return (
    <Modal title="Parameters" onClose={onClose}>
      <p className="hint">
        Values are substituted into <code>{'{{ NAME }}'}</code> placeholders and exported to cells as environment
        variables. Secrets are registered with the agent and redacted from the <code>.runtpt</code>.
      </p>
      <div className="fields">
        {specs.map((spec) => (
          <Field key={spec.name} spec={spec} runner={runner} />
        ))}
      </div>
      {blocked && <p className="error">Still missing: {runner.missingParams.join(', ')}</p>}
      <div className="row end">
        <button
          className="primary"
          disabled={blocked}
          onClick={() => {
            runner.markParamsAnswered()
            onConfirm()
          }}
        >
          Use these values
        </button>
      </div>
    </Modal>
  )
}
