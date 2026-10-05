export const gib = (mib: number): string => `${(mib / 1024).toFixed(1)} GiB`

export const ratio = (partMiB: number, totalMiB: number): string =>
  `${(partMiB / 1024).toFixed(1)} of ${gib(totalMiB)}`

export const duration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

export const bar = (used: number, total: number, width: number): string => {
  const share = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  const filled = Math.round(share * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const clean = (text: string, max: number): string => {
  const flat = text
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export const shortId = (id: string): string => id.slice(0, 4)
