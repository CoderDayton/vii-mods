import type { Register } from 'claude-code'

import { readOptions } from '../src/options'
import { rewriteSudo } from '../src/rewrite'

export const register: Register = (on, options) => {
  const config = readOptions(options)

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const out = rewriteSudo(e.command, { ...config, askpass: `${$.plugin.root}/bin/askpass.sh` })
    if (out.kind === 'deny') return { deny: `${$.plugin.name}: ${out.reason}` }
    return out.kind === 'run' ? next({ ...e, command: out.command }) : next(e)
  })
}
