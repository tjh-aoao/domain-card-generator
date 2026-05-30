export function getProxiedUrl(url: string | undefined | null) {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/') || !trimmed.startsWith('http')) {
    return trimmed;
  }
  return `/api/proxy?url=${encodeURIComponent(trimmed)}`;
}
