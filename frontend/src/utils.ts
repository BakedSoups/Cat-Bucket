export function formatFileSize(size: number) {
  const sizeInKb = Math.max(1, Math.round(size / 1024))
  return `${sizeInKb} KB`
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}
