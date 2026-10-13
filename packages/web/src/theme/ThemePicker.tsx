import { THEMES, type ThemeChoice } from './themes.js'

interface Props {
  choice: ThemeChoice
  system: string
  onChoose: (next: ThemeChoice) => void
}

export function ThemePicker({ choice, system, onChoose }: Props) {
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      <button
        className={`theme-option ${choice === 'system' ? 'selected' : ''}`}
        role="radio"
        aria-checked={choice === 'system'}
        onClick={() => onChoose('system')}
      >
        <span className="theme-name">System</span>
        <span className="meta">follows this machine ({system})</span>
      </button>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          className={`theme-option ${choice === theme.id ? 'selected' : ''}`}
          role="radio"
          aria-checked={choice === theme.id}
          onClick={() => onChoose(theme.id)}
        >
          <span className="theme-name">{theme.label}</span>
          <span className="meta">{theme.about}</span>
          <span className="theme-swatch" data-theme={theme.id} aria-hidden="true">
            <i className="sw-bg" />
            <i className="sw-accent" />
            <i className="sw-ok" />
            <i className="sw-bad" />
          </span>
        </button>
      ))}
    </div>
  )
}
