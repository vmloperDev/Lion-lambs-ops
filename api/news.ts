// api/news.ts
// Vercel Serverless Function — proxies a free public RSS feed (Google News,
// Philippines edition) and returns it as small, clean JSON. This exists
// because browsers can't fetch most RSS feeds directly (no CORS headers on
// the feed itself), so the request has to go through our own server first.
//
// No API key, no signup, no rate-limit headaches — just a plain RSS feed
// that anyone can read. Swap FEED_URL below to point at a specific outlet's
// RSS feed (Rappler, Inquirer, ABS-CBN, PhilStar, etc.) if you'd rather have
// single-source headlines instead of the aggregated Google News mix.

import type { VercelRequest, VercelResponse } from '@vercel/node'

// Google News, Philippines edition, top stories.
const FEED_URL = 'https://news.google.com/rss?hl=en-PH&gl=PH&ceid=PH:en'

export interface NewsItem {
  title: string
  link: string
  source: string
  pubDate: string
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

function extractSource(block: string): string {
  // Google News wraps the publisher name like: <source url="...">Rappler</source>
  const match = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)
  return match ? decodeEntities(match[1].trim()) : ''
}

function parseRss(xml: string, limit: number): NewsItem[] {
  const items: NewsItem[] = []
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || []

  for (const block of itemBlocks) {
    if (items.length >= limit) break
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate')
    const source = extractSource(block)
    if (title && link) items.push({ title, link, source, pubDate })
  }

  return items
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const limitParam = Number(req.query.limit)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 30) : 12

  try {
    const feedRes = await fetch(FEED_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LionAndLambOps/1.0)' },
    })

    if (!feedRes.ok) {
      return res.status(502).json({ error: `Feed fetch failed (${feedRes.status})` })
    }

    const xml = await feedRes.text()
    const items = parseRss(xml, limit)

    // Cache at the edge for 10 minutes so we're not hammering the feed on
    // every page load — browsers/CDN will happily reuse this response.
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800')
    return res.status(200).json({ items, updatedAt: new Date().toISOString() })
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to load news' })
  }
}
