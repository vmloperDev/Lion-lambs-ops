// api/news-images.ts
//
// IMPORTANT: this intentionally does NOT reuse the Google News aggregator
// feed from api/news.ts. Google News RSS <link> values point at a
// news.google.com redirect page that resolves to the real article via
// client-side JS — a browser tab follows that fine, but a server-side
// fetch() just gets Google's stub page back, which has no usable
// og:image. That's why the gallery originally showed nothing.
//
// Image quality/priority, in order:
//   1. og:image scraped directly from the article page — this is what the
//      publisher hands to Facebook/Twitter for link previews, so it's
//      almost always their best, full-resolution version of the photo.
//   2. If that scrape fails (timeout, blocked, missing tag), fall back to
//      whatever image is embedded in the RSS feed itself. Feed images are
//      often a small WordPress "thumbnail" size (e.g. ...-150x150.jpg), so
//      we also try stripping that resize suffix to request the original
//      full-size file from the same URL.

import type { VercelRequest, VercelResponse } from '@vercel/node'

// Rappler's main feed. Swap this to any other outlet's RSS URL if you'd
// rather pull from Inquirer, PhilStar, ABS-CBN, etc.
const FEED_URL = 'https://www.rappler.com/feed/'
const UA = 'Mozilla/5.0 (compatible; LionAndLambOps/1.0)'
const PER_ARTICLE_TIMEOUT_MS = 4000

export interface NewsImageItem {
  title: string
  link: string
  source: string
  pubDate: string
  image: string | null
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match) return ''
  return decodeEntities(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim())
}

// WordPress (and Rappler runs on WP) generates resized copies of every
// upload named like "photo-800x450.jpg". The RSS feed usually links one of
// those small resized copies rather than "photo.jpg" (the original). If we
// see that pattern, request the original instead — usually much sharper.
function upscale(url: string): string {
  return url.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))(\?.*)?$/i, '$1$2')
}

// Tries every common way an RSS item embeds an image. Where a tag can
// appear more than once (media:content) or carry a width attribute, we
// pick the largest available rather than just the first match.
function extractFeedImage(block: string): string | null {
  const mediaMatches = [...block.matchAll(/<media:content\b[^>]*>/gi)]
  if (mediaMatches.length) {
    const withWidth = mediaMatches
      .map((m) => {
        const url = m[0].match(/url=["']([^"']+)["']/i)?.[1]
        const width = Number(m[0].match(/width=["'](\d+)["']/i)?.[1] ?? 0)
        return url ? { url, width } : null
      })
      .filter(Boolean) as { url: string; width: number }[]
    if (withWidth.length) {
      withWidth.sort((a, b) => b.width - a.width)
      return upscale(decodeEntities(withWidth[0].url))
    }
  }

  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i)
  if (enclosure && /image|\.(jpe?g|png|webp|gif)(\?|$)/i.test(enclosure[0])) {
    return upscale(decodeEntities(enclosure[1]))
  }

  const thumbnail = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i)
  if (thumbnail) return upscale(decodeEntities(thumbnail[1]))

  const description = extractTag(block, 'description') || extractTag(block, 'content:encoded')
  const img = description.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (img) return upscale(decodeEntities(img[1]))

  return null
}

function parseRss(xml: string, limit: number) {
  const items: { title: string; link: string; source: string; pubDate: string; feedImage: string | null }[] = []
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || []

  for (const block of itemBlocks) {
    if (items.length >= limit) break
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate')
    const feedImage = extractFeedImage(block)
    if (title && link) items.push({ title, link, source: 'Rappler', pubDate, feedImage })
  }

  return items
}

// Primary image source: og:image from the article page itself (real
// publisher URL from the feed, not a redirect stub, so this works).
async function scrapeImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PER_ARTICLE_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null

    const html = await res.text()
    const head = html.slice(0, 60000)

    const metaMatch =
      head.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      head.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      head.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)

    if (!metaMatch) return null
    const src = decodeEntities(metaMatch[1].trim())
    return src.startsWith('http') ? src : null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const limitParam = Number(req.query.limit)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 8) : 4

  try {
    const feedRes = await fetch(FEED_URL, { headers: { 'User-Agent': UA } })
    if (!feedRes.ok) {
      return res.status(502).json({ error: `Feed fetch failed (${feedRes.status})` })
    }

    const xml = await feedRes.text()
    const candidates = parseRss(xml, limit + 4)

    const withImages = await Promise.all(
      candidates.map(async (item) => {
        const scraped = await scrapeImage(item.link)
        const { feedImage, ...rest } = item
        return { ...rest, image: scraped || feedImage || null }
      })
    )

    const items: NewsImageItem[] = withImages.filter((i) => i.image).slice(0, limit)

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800')
    return res.status(200).json({ items, updatedAt: new Date().toISOString() })
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to load news images' })
  }
}
