import { Modal } from './Modal.js'

const KEYS: [string, string][] = [
  ['Enter', 'run the focused cell'],
  ['Shift + Enter', 'run it and move to the next cell'],
  ['Ctrl / Cmd + Enter', 'run all'],
  ['j / k, ↓ / ↑', 'move the focus'],
  ['c', 'cancel the running cell'],
  ['o', 'open a runbook'],
  ['s', 'save the recording'],
  ['P', 'presentation mode'],
  ['→ / Space, ←', 'next / previous slide or reveal'],
  ['Esc', 'leave presentation mode or close a dialog'],
  ['?', 'this list'],
]

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard" onClose={onClose}>
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
    </Modal>
  )
}
