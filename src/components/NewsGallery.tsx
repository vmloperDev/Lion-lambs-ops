import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'

interface NewsImageItem {
  title: string
  link: string
  source: string
  pubDate: string
  image: string | null
}

const REFRESH_MS = 15 * 60 * 1000 // 15 minutes

export default function NewsGallery() {
  const [items, setItems] = useState<NewsImageItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // Links whose image URL turned out to be broken once the browser actually
  // tried to load it (dead link, hotlink-blocked, etc). Server-side we can
  // only confirm a URL exists, not that it'll load — so we filter these out
  // here instead of showing a broken-image icon.
  const [brokenLinks, setBrokenLinks] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/news-images?limit=6')
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : [])
          setBrokenLinks(new Set())
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const visibleItems = items.filter((item) => !brokenLinks.has(item.link)).slice(0, 4)

  if (status === 'error' || (status === 'ready' && visibleItems.length === 0)) return null

  return (
    <div className="news-gallery">
      <div className="news-gallery-heading">
        <span>In photos</span>
      </div>
      <div className="news-gallery-grid">
        {status === 'loading'
          ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="news-gallery-card news-gallery-card--loading">
              <div className="news-gallery-thumb-placeholder"><ImageOff size={18} /></div>
              <div className="news-gallery-caption">Loading…</div>
            </div>
          ))
          : visibleItems.map((item, i) => (
            <a
              key={`${item.link}-${i}`}
              className="news-gallery-card"
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              title={item.title}
            >
              <div className="news-gallery-thumb">
                <img
                  src={item.image ?? ''}
                  alt=""
                  loading="lazy"
                  onError={() => setBrokenLinks((prev) => new Set(prev).add(item.link))}
                />
              </div>
              <div className="news-gallery-caption">
                {item.source && <span className="news-gallery-source">{item.source}</span>}
                <span className="news-gallery-title">{item.title}</span>
              </div>
            </a>
          ))
        }
      </div>
    </div>
  )
}
