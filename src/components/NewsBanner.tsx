import { useEffect, useState } from 'react'
import { Newspaper } from 'lucide-react'

interface NewsItem {
  title: string
  link: string
  source: string
  pubDate: string
}

const REFRESH_MS = 15 * 60 * 1000 // 15 minutes

export default function NewsBanner() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/news?limit=12')
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : [])
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

  if (status === 'error' || (status === 'ready' && items.length === 0)) return null

  return (
    <div className="news-banner">
      <span className="news-banner-tag">
        <Newspaper size={13} />
        BREAKING NEWS
      </span>
      <div className="news-banner-track">
        <div className="news-banner-scroll">
          {status === 'loading'
            ? <span className="news-banner-item news-banner-item--loading">Loading latest headlines…</span>
            : [...items, ...items].map((item, i) => (
              <a
                key={`${item.link}-${i}`}
                className="news-banner-item"
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                title={item.title}
              >
                {item.source && <span className="news-banner-source">{item.source}</span>}
                {item.title}
              </a>
            ))
          }
        </div>
      </div>
    </div>
  )
}
