import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * checking: first status request still in flight.
 * ready: the server has an API key.
 * missing-key: the server is up but nobody has added a key yet.
 * server-offline: the app server could not be reached.
 */
export type AiSetupState = 'checking' | 'ready' | 'missing-key' | 'server-offline'

const DEBUG_QUERY = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'

/** Tracks whether the live AI assistant is set up. `refresh` re-asks the server, so a key added by anyone is picked up. */
export function useAiStatus() {
  const [state, setState] = useState<AiSetupState>('checking')
  const [keyPromptEnabled, setKeyPromptEnabled] = useState(false)
  const [demoDebug, setDemoDebug] = useState(DEBUG_QUERY)

  /** Re-asks the server. `promptable` is true when the setup prompt should be shown now. */
  const refresh = useCallback(async (): Promise<{ state: AiSetupState; promptable: boolean }> => {
    let next: AiSetupState
    let promptEnabled: boolean
    try {
      const status = await api.getAiStatus()
      next = status.configured ? 'ready' : 'missing-key'
      promptEnabled = status.keyPromptEnabled
      setDemoDebug(DEBUG_QUERY || status.demoDebug)
    } catch {
      next = 'server-offline'
      // Without the server we cannot know its settings. Only the dev build (npm run dev) shows setup messages then.
      promptEnabled = import.meta.env.DEV
    }
    setKeyPromptEnabled(promptEnabled)
    setState(next)
    return { state: next, promptable: promptEnabled && next !== 'ready' }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    state,
    refresh,
    /** Setup messages ("AI is off…") are for the developer, never for a demo audience. */
    showSetup: keyPromptEnabled && (state === 'missing-key' || state === 'server-offline'),
    keyPromptEnabled,
    demoDebug,
    markReady: useCallback(() => setState('ready'), []),
  }
}
