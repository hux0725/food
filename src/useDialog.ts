import { useEffect, useLayoutEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open dialogs, newest last. Only the top one reacts to Esc and Tab. */
const stack: symbol[] = []

/**
 * Modal behaviour for a dialog element: focus moves in on open, Tab stays inside,
 * Esc closes, and focus returns to whatever opened it.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const id = Symbol('dialog')
    stack.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = ref.current
    const focusables = () => (node ? [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0) : [])
    const initial = node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? node
    initial?.focus({ preventScroll: true })

    function onKeyDown(event: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = focusables()
      if (!items.length) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      stack.splice(stack.indexOf(id), 1)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return ref
}
