import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeToggle from './ThemeToggle'
import { getTheme, resetThemeForTests } from '../theme/themeStore'

beforeEach(() => resetThemeForTests())
afterEach(() => resetThemeForTests())

describe('ThemeToggle', () => {
  it('shows both options at once, not one changing label', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Office' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /宗門/ })).toBeInTheDocument()
  })

  it('marks the active option for assistive tech', async () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Office' }))
      .toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /宗門/ }))
    expect(screen.getByRole('button', { name: /宗門/ }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Office' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('switching the theme reaches the document, not just React', async () => {
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button', { name: /宗門/ }))
    expect(getTheme()).toBe('sect')
    expect(document.documentElement.getAttribute('data-theme')).toBe('sect')
  })
})
