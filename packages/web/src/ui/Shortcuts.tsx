import { Modal } from './Modal.js'
import { ThemePicker } from '../theme/ThemePicker.js'
import type { ThemeState } from '../theme/useTheme.js'

const KEYS: [string, string][] = [
  ['Enter', 'run the focused cell'],
  ['Shift + Enter', 'run it and move to the next cell'],
  ['Ctrl / Cmd + Enter', 'run all'],
  ['j / k, ↓ / ↑', 'move the focus'],
  ['c', 'cancel the running cell'],
  ['o', 'open a runbook'],
  ['r', 'reload the open runbook from its source'],
  ['v', 'session variables'],
  ['s', 'save the recording'],
  ['P', 'presentation mode'],
  ['→ / Space, ←', 'next / previous slide or reveal'],
  ['Esc', 'leave presentation mode or close a dialog'],
  ['?', 'this list'],
]

export function Shortcuts({ theme, onClose }: { theme: ThemeState; onClose: () => void }) {
  return (
    <Modal title="Preferences" onClose={onClose}>
      <section className="prefs-section">
        <h3 className="prefs-head">Theme</h3>
        <p className="hint">Kept on this machine, not in the runbook.</p>
        <ThemePicker choice={theme.choice} system={theme.system} onChoose={theme.setChoice} />
      </section>

      <section className="prefs-section">
        <h3 className="prefs-head">Keyboard</h3>
        <table className="keys">
          <tbody>
            {KEYS.map(([key, what]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Modal>
  )
}
