import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function FloatingDropdownMenu({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<{ top: number; left: number; minWidth: number; maxHeight: number; openUp: boolean } | null>(null)

  useEffect(() => {
    const MARGIN = 8

    function reposition() {
      const anchor = anchorRef.current
      const menu = menuRef.current
      if (!anchor) return

      const anchorRect = anchor.getBoundingClientRect()
      const menuHeight = menu?.offsetHeight ?? 260
      const menuWidth = Math.max(menu?.offsetWidth ?? 0, anchorRect.width, 220)

      const spaceBelow = window.innerHeight - anchorRect.bottom - MARGIN
      const spaceAbove = anchorRect.top - MARGIN
      const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow

      const maxHeight = Math.max(140, Math.min(260, openUp ? spaceAbove : spaceBelow))

      let left = anchorRect.left
      const maxLeft = window.innerWidth - menuWidth - MARGIN
      if (left > maxLeft) left = Math.max(MARGIN, maxLeft)
      if (left < MARGIN) left = MARGIN

      const top = openUp ? anchorRect.top - Math.min(menuHeight, maxHeight) : anchorRect.bottom

      setStyle({ top, left, minWidth: anchorRect.width, maxHeight, openUp })
    }

    reposition()
    const raf = requestAnimationFrame(reposition)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={menuRef}
      className={`custom-select-menu custom-select-menu-portal${style?.openUp ? ' open-up' : ''}`}
      style={{
        position: 'fixed',
        top: style ? style.top : -9999,
        left: style ? style.left : -9999,
        minWidth: style?.minWidth,
        maxHeight: style?.maxHeight,
        visibility: style ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
