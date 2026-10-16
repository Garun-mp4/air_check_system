'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

type FullscreenMode = 'native' | 'viewport' | null

export function useSceneFullscreen(target: RefObject<HTMLElement | null>, toggleButton: RefObject<HTMLButtonElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const currentMode = useRef<FullscreenMode>(null)
  const changing = useRef(false)
  const ownedElement = useRef<HTMLElement | null>(null)
  const expanded = mode !== null

  const changeMode = useCallback((next: FullscreenMode) => {
    currentMode.current = next
    if (mounted.current) setMode(next)
  }, [])

  useEffect(() => {
    mounted.current = true
    const synchronize = () => {
      if (ownedElement.current && document.fullscreenElement === ownedElement.current) changeMode('native')
      else if (currentMode.current === 'native') changeMode(null)
    }
    document.addEventListener('fullscreenchange', synchronize)
    return () => {
      mounted.current = false
      document.removeEventListener('fullscreenchange', synchronize)
      if (ownedElement.current && document.fullscreenElement === ownedElement.current) {
        void document.exitFullscreen().catch(() => { /* The browser also exits when the element is removed. */ })
      }
    }
  }, [changeMode])

  const exit = useCallback(async () => {
    if (changing.current) return
    changing.current = true
    setPending(true)
    setError(null)
    try {
      if (ownedElement.current && document.fullscreenElement === ownedElement.current) await document.exitFullscreen()
      changeMode(document.fullscreenElement === ownedElement.current && ownedElement.current ? 'native' : null)
    } catch {
      if (mounted.current) setError('Не удалось свернуть стенд. Нажмите Esc или повторите нажатие.')
    } finally {
      changing.current = false
      if (mounted.current) setPending(false)
    }
  }, [changeMode])

  const enter = useCallback(async () => {
    const element = target.current
    if (!element || changing.current) return
    changing.current = true
    ownedElement.current = element
    setPending(true)
    setError(null)
    try {
      if (typeof element.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
        await element.requestFullscreen({ navigationUI: 'hide' })
        // Esc may already have closed native fullscreen before its promise settles.
        if (mounted.current) changeMode(document.fullscreenElement === element ? 'native' : null)
        else if (document.fullscreenElement === element) await document.exitFullscreen()
      } else changeMode('viewport')
    } catch {
      // Embedded browsers and phones may disallow the native API; keep the same controls in a viewport-filling view.
      if (mounted.current && element.isConnected) changeMode('viewport')
    } finally {
      changing.current = false
      if (mounted.current) setPending(false)
    }
  }, [changeMode, target])

  const toggle = useCallback(() => currentMode.current === null ? enter() : exit(), [enter, exit])

  useEffect(() => {
    const element = target.current
    if (!expanded || !element) return
    const overflow = document.body.style.overflow
    const scroll = { x: window.scrollX, y: window.scrollY }
    const background: Array<[HTMLElement, string | null]> = []
    // Inert siblings at each ancestor level, keeping the workspace and its controls accessible.
    for (let branch: HTMLElement | null = element; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          background.push([sibling, sibling.getAttribute('inert')])
          sibling.setAttribute('inert', '')
        }
      }
      if (branch.parentElement === document.body) break
    }
    document.body.style.overflow = 'hidden'
    toggleButton.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !changing.current) {
        event.preventDefault()
        event.stopPropagation()
        void exit()
      } else if (event.key === 'Tab') {
        const focusable = Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(item => item.getClientRects().length > 0 && !item.closest('[inert]'))
        const first = focusable[0], last = focusable.at(-1)
        if (!first || !last) { event.preventDefault(); return }
        if (!element.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      for (const [sibling, previous] of background) {
        if (previous === null) sibling.removeAttribute('inert')
        else sibling.setAttribute('inert', previous)
      }
      if (mounted.current) requestAnimationFrame(() => {
        if (!mounted.current) return
        window.scrollTo(scroll.x, scroll.y)
        toggleButton.current?.focus({ preventScroll: true })
      })
    }
  }, [expanded, exit, target, toggleButton])

  return { expanded, mode, pending, error, toggle, exit }
}
