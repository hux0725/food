import { Component, type ReactNode } from 'react'

/** Last line of defence: any render error shows a friendly reload card instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="stage">
        <section className="phone crash-card" role="alert" data-testid="error-boundary">
          <p className="eyebrow">SOMETHING WENT WRONG</p>
          <h1>Let's reload that.</h1>
          <p>The page hit a snag. Your saved plans and places are safe on the server.</p>
          <button type="button" className="continue-btn" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </section>
      </main>
    )
  }
}
