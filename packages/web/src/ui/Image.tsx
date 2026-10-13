import { useAsset, useAssets } from '../assets/context.js'
import { isExternal } from '../assets/resolve.js'

interface Props {
  src?: string | undefined
  alt?: string | undefined
  title?: string | undefined
}

function Box({
  state,
  alt,
  detail,
  title,
  onRetry,
}: {
  state: string
  alt: string
  detail: string
  title?: string | undefined
  onRetry?: (() => void) | undefined
}) {
  return (
    <span className={`md-image-box ${state}`} title={title ?? detail}>
      <span className="md-image-alt">{alt}</span>
      <span className="meta">{detail}</span>
      {onRetry && (
        <button type="button" className="ghost small" onClick={onRetry}>
          Retry
        </button>
      )}
    </span>
  )
}

/** Markdown `![alt](path)`, resolved against wherever the runbook came from. */
export function Image({ src, alt, title }: Props) {
  const assets = useAssets()
  const { path, entry, retry } = useAsset(src ?? '')
  const label = alt?.trim() || 'image'

  if (!src) return null
  if (isExternal(src)) {
    return <img className="md-image" src={src} alt={alt ?? ''} title={title} loading="lazy" />
  }
  if (!assets) {
    return <Box state="failed" alt={label} detail="images are only shown in the document views" title={title} />
  }
  if (!path) {
    return <Box state="failed" alt={label} detail={`"${src}" points outside the runbook's root`} title={title} />
  }

  if (entry?.status === 'ready') {
    const source = assets.mode === 'export' ? `data:${entry.mime};base64,${entry.base64}` : entry.url
    return <img className="md-image" src={source} alt={alt ?? ''} title={title} />
  }
  if (assets.mode === 'export') {
    // Nothing loaded means nothing to inline: the alt text is the honest export.
    return <span className="md-image-alt">{alt ?? ''}</span>
  }
  if (entry?.status === 'error') {
    return <Box state="failed" alt={label} detail={entry.message} title={title} onRetry={retry} />
  }
  return <Box state="loading" alt={label} detail={`loading ${path}…`} title={title} />
}
