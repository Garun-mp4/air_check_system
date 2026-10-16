import { expect, type Page } from '@playwright/test'

export async function exerciseSceneFullscreen(page: Page, mode: 'real' | 'simulation') {
  const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const workspace = page.locator('#simulator-workspace')
  const canvas = await workspace.locator('canvas').elementHandle()
  if (!canvas) throw new Error('Rendered canvas is missing')
  const original = await canvas.boundingBox()
  if (!original) throw new Error('Canvas has no visible bounds')
  const enter = page.getByRole('button', { name: 'Развернуть 3D-стенд на весь экран', exact: true })
  const exit = page.getByRole('button', { name: 'Выйти из полноэкранного режима', exact: true })

  await enter.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('simulator-workspace')
  await expect(workspace).toHaveClass(/is-expanded/)
  await expect(exit).toBeVisible()
  await expect.poll(async () => {
    const bounds = await canvas.boundingBox()
    return bounds ? bounds.width * bounds.height : 0
  }).toBeGreaterThan(original.width * original.height)
  expect(await canvas.evaluate(element => element.isConnected && element === document.querySelector('canvas'))).toBe(true)
  await workspace.getByRole('group', { name: 'Режим отображения сцены' }).getByRole('button', { name: 'Проводка', exact: true }).click()
  await workspace.getByRole('button', { name: 'Устройства', exact: true }).click()
  await workspace.getByLabel('Устройство стенда', { exact: true }).selectOption('window.actuator')
  await expect(workspace.locator('.sim-command-buttons')).toBeVisible()
  await workspace.getByRole('button', { name: 'Закрыть сведения об устройстве', exact: true }).click()
  await expect(workspace.getByRole('button', { name: 'Устройства', exact: true })).toBeFocused()
  await page.keyboard.down('w')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.up('w')
  await page.screenshot({ path: '../tests/browser/artifacts/fullscreen-' + mode + '.png' })
  await exit.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
  await expect(workspace).not.toHaveClass(/is-expanded/)
  await expect(workspace.getByLabel('Устройство стенда', { exact: true })).toHaveValue('window.actuator')
  await expect(workspace.getByRole('button', { name: 'Проводка', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await canvas.evaluate(element => element.isConnected)).toBe(true)

  await enter.click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('simulator-workspace')
  await page.keyboard.press('Escape')
  await expect(workspace).not.toHaveClass(/is-expanded/)
  await expect(enter).toBeFocused()

  // Exercise the actual viewport layout when an embedded/mobile browser lacks the native API.
  const originalViewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await workspace.evaluate(element => Object.defineProperty(element, 'requestFullscreen', { configurable: true, value: undefined }))
  try {
    for (const viewport of [originalViewport, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      await enter.click()
      await expect(workspace).toHaveClass(/is-expanded/)
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
      const bounds = await workspace.boundingBox()
      expect(bounds?.x).toBe(0); expect(bounds?.y).toBe(0)
      expect(Math.abs(bounds!.width - viewport.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(bounds!.height - viewport.height)).toBeLessThanOrEqual(1)
      const exitBounds = (await exit.boundingBox())!
      expect(exitBounds.x).toBeGreaterThanOrEqual(0)
      expect(exitBounds.y).toBeGreaterThanOrEqual(0)
      expect(exitBounds.x + exitBounds.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(exitBounds.y + exitBounds.height).toBeLessThanOrEqual(viewport.height + 1)
      await workspace.getByRole('button', { name: 'Устройства', exact: true }).click()
      await workspace.getByLabel('Устройство стенда', { exact: true }).selectOption('window.actuator')
      await workspace.getByRole('button', { name: 'Закрыть сведения об устройстве', exact: true }).click()
      await expect(workspace.getByRole('button', { name: 'Устройства', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(workspace).not.toHaveClass(/is-expanded/)
      await expect(enter).toBeFocused()
    }
  } finally {
    await workspace.evaluate(element => Reflect.deleteProperty(element, 'requestFullscreen'))
    await page.setViewportSize(originalViewport)
  }
  await workspace.getByLabel('Устройство стенда', { exact: true }).selectOption('')
  await workspace.getByRole('button', { name: 'Общий вид', exact: true }).click()
  await workspace.getByRole('button', { name: 'Сбросить камеру', exact: true }).click()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
}
