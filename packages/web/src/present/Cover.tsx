import type { ReactNode } from 'react'
import { isCoverSlide, type PresentationSettings, type Slide } from '@runtpt/core'
import { useAsset, useAssets } from '../assets/context.js'
import { isExternal } from '../assets/resolve.js'

export type CoverStyle = 'center' | 'split' | 'full' | 'band'

/**
 * The layout slide 0 is dressed in, or null for the ordinary slide rendering.
 * An explicit layout is honoured as written; `auto` only fires on a slide that
 * is already a title, so a deck that never asked for a cover keeps its look.
 */
export function coverStyleOf(settings: PresentationSettings, slide: Slide | undefined): CoverStyle | null {
  if (!slide || settings.cover === 'none') return null
  if (settings.cover === 'auto') return isCoverSlide(slide) ? 'center' : null
  return settings.cover
}

/** `split` and `full` are picture layouts: with nothing to show they are `center`. */
export function withImage(style: CoverStyle, hasImage: boolean): CoverStyle {
  if (hasImage) return style
  return style === 'split' || style === 'full' ? 'center' : style
}

interface CoverImage {
  url: string
  /** A drawing is contained and never cropped; a photograph may fill its box. */
  vector: boolean
}

/** Only bytes already in hand count: a cover never shows a broken image. */
function useCoverImage(src: string | undefined): CoverImage | null {
  const assets = useAssets()
  const { entry } = useAsset(src ?? '')
  if (!src) return null
  if (isExternal(src)) return { url: src, vector: /\.svgz?(?:[?#]|$)/i.test(src) }
  if (!assets || entry?.status !== 'ready') return null
  const url = assets.mode === 'export' ? `data:${entry.mime};base64,${entry.base64}` : entry.url
  return { url, vector: entry.mime === 'image/svg+xml' }
}

export function Cover({
  style,
  image,
  children,
}: {
  style: CoverStyle
  image?: string | undefined
  children: ReactNode
}) {
  const picture = useCoverImage(image)
  const layout = withImage(style, picture !== null)

  return (
    <div className={`cover cover-${layout}`}>
      {picture && (
        <div className="cover-figure" data-kind={picture.vector ? 'vector' : 'raster'}>
          <img src={picture.url} alt="" />
        </div>
      )}
      {picture && layout === 'full' && <div className="cover-scrim" />}
      <div className="cover-text">
        <div className="slide-inner">{children}</div>
      </div>
    </div>
  )
}
