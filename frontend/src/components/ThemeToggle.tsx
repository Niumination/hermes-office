import { useTheme, setTheme } from '../theme/themeStore'

/**
 * ThemeToggle — switches the office between the default art and 宗門.
 *
 * It is a two-state switch with both states always visible, not an icon
 * button that changes meaning when you press it: the second kind forces the
 * reader to remember whether the icon shows the current state or the one
 * they would get. `aria-pressed` carries the state for assistive tech, and
 * each option keeps its own label, so the choice is readable without colour.
 */
export default function ThemeToggle() {
  const theme = useTheme()
  return (
    <div className="theme-toggle" role="group" aria-label="Office theme">
      <button
        type="button"
        className="theme-toggle__opt"
        aria-pressed={theme === 'default'}
        onClick={() => setTheme('default')}
      >
        Office
      </button>
      <button
        type="button"
        className="theme-toggle__opt"
        aria-pressed={theme === 'sect'}
        onClick={() => setTheme('sect')}
      >
        宗門<span className="theme-toggle__gloss"> Sect</span>
      </button>
    </div>
  )
}
