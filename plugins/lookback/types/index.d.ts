// Notes this session was already given, each kept by its file path, error text or session id.
export type Shown = string[]

declare module 'claude-code' {
  interface PluginState {
    lookback: {
      noted: Shown
      lookedUp: Shown
      shown: Shown
      // The lines search results sent, by loop: '' for the main conversation, else the subagent's id.
      sent: Record<string, Shown>
    }
  }
}
