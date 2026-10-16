import { test, expect } from '@playwright/test'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { Pool } from 'pg'
import { exerciseSceneFullscreen } from './fullscreen'

test('one real controller: partial sensors, confirmed window, archive isolation and reconnect', async ({ page }) => {
  const owner = JSON.parse(await readFile(process.env.E2E_ACCOUNT_FILE!, 'utf8'))
  const stateFile = process.env.E2E_STATE_FILE!
  const headers = { Origin: process.env.E2E_BASE_URL! }
  const setState = async (state: object) => {
    await writeFile(stateFile + '.next', JSON.stringify(state))
    await rename(stateFile + '.next', stateFile)
  }
  const snapshot = async () => (await (await page.request.get('/api/simulator/state')).json()).data
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(owner.email)
  await page.getByLabel('Пароль', { exact: true }).fill(owner.password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect.poll(async () => (await (await page.request.get('/api/auth/access')).json()).data?.role).toBe('owner')
  expect((await page.request.patch('/api/v1/settings', { headers, data: { device_id: 'room-01', automation_enabled: false } })).status()).toBe(200)
  await expect.poll(async () => (await snapshot()).indoor.co2_ppm).toBe(900)
  for (const [width, height] of [[390, 844], [320, 740]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    const reading = page.locator('.current-reading-value')
    await expect(reading).toContainText('900')
    const valueBounds = await reading.boundingBox()
    const navigationBounds = await page.locator('.mobile-bottom-nav').boundingBox()
    expect(valueBounds).not.toBeNull()
    expect(navigationBounds).not.toBeNull()
    expect(valueBounds!.y + valueBounds!.height).toBeLessThanOrEqual(navigationBounds!.y)
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/simulator')
  await expect(page.getByText('Реальная система · ESP32', { exact: true })).toBeVisible()
  await expect(page.getByText('Одна ESP32 · показания устройств', { exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await exerciseSceneFullscreen(page, 'real')
  await expect(page.locator('.sim-stage-state')).toContainText('0%')
  expect((await page.request.post('/api/simulator/actions', { headers, data: { action: 'pause' } })).status()).toBe(403)
  expect((await page.request.post('/api/v1/telemetry', { headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN, 'X-AirCheck-Source': 'simulator' }, data: {} })).status()).toBe(403)
  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    await db.query(`INSERT INTO actuator_commands(device_id,target,desired_state,source,reason,batch_id,status,failure_reason,completed_at,created_at) VALUES('room-01','intake',true,'manual','Inactive fixture','inactive-source-test','failed','Failure in another mode',clock_timestamp(),(SELECT updated_at-interval '1 minute' FROM runtime_device_modes WHERE device_id='room-01'))`)
  } finally { await db.end() }
  expect((await (await page.request.get('/api/v1/events')).json()).data.filter((event: { kind: string }) => event.kind === 'command_failed')).toHaveLength(0)

  // A failed PM sensor leaves independently healthy climate channels live.
  await setState({ failed_sensor: 'indoor_particles' })
  await expect.poll(async () => (await snapshot()).indoor.pm25_ug_m3).toBeNull()
  expect((await snapshot()).indoor.co2_ppm).toBe(900)
  await page.goto('/')
  await expect(page.locator('.telemetry-diagnostics')).toBeVisible()
  await page.locator('.telemetry-diagnostics summary').click()
  await expect(page.locator('.telemetry-diagnostics')).toContainText('последнее измерение')

  await setState({})
  await expect.poll(async () => (await snapshot()).indoor.pm25_ug_m3).toBe(8)
  await page.goto('/simulator')
  await page.getByRole('button', { name: 'Развернуть 3D-стенд на весь экран', exact: true }).click()
  await expect(page.locator('#simulator-workspace')).toHaveClass(/is-expanded/)
  await page.locator('#simulator-workspace').getByRole('button', { name: 'Устройства', exact: true }).click()
  await page.getByLabel('Устройство стенда', { exact: true }).selectOption('window.actuator')
  const commandResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/controls/commands' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Открыть окно', exact: true }).click()
  const response = await commandResponse
  expect(response.status()).toBe(202)
  const command = (await response.json()).data.commands[0]
  expect((await snapshot()).window.actual_position_percent).toBe(0)
  await setState({ window_position: 100, applied_ids: [command.id] })
  await expect.poll(async () => (await snapshot()).window.actual_position_percent).toBe(100)
  await expect.poll(async () => (await (await page.request.get('/api/v1/controls')).json()).data.recent_commands.find((item: { id: number }) => item.id === command.id)?.status).toBe('applied')
  await expect(page.locator('.sim-stage-state')).toContainText('100%')
  await page.screenshot({ path: '../tests/browser/artifacts/real-window-open-fullscreen.png' })
  await page.getByRole('button', { name: 'Выйти из полноэкранного режима', exact: true }).click()
  await page.goto('/simulator')
  await expect(page.locator('.sim-stage-state')).toContainText('100%')
  await page.screenshot({ path: '../tests/browser/artifacts/real-window-open.png' })

  // An archived frame describing a different pose never owns live feedback.
  const frame = structuredClone((await snapshot()).telemetry.frame)
  frame.boot_id = 'synthetic-archive'; frame.sequence = 0
  frame.actuators.window = { open_limit: false, close_limit: true, position_percent: 0, position_quality: 'measured', motion: 'stopped' }
  frame.command_results = []
  const archived = await page.request.post('/api/v1/telemetry', { headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN, 'X-AirCheck-Source': 'real', 'X-AirCheck-Delivery': 'archive' }, data: frame })
  expect(archived.status()).toBe(201)
  expect((await archived.json()).data.current).toBe(false)
  expect((await snapshot()).window.actual_position_percent).toBe(100)

  await setState({ window_position: null })
  await expect.poll(async () => (await snapshot()).window.position_quality).toBe('unknown')
  await expect(page.locator('.sim-stage-state')).toContainText('нет подтверждения')
  await setState({ window_position: 100, paused: true })
  await expect.poll(async () => (await snapshot()).connection.controller, { timeout: 15000 }).toBe('offline')
  await expect(page.locator('.sim-stage-state')).toContainText('нет подтверждения')
  await setState({ window_position: 0 })
  await expect.poll(async () => (await snapshot()).connection.controller).toBe('online')
  await expect(page.locator('.sim-stage-state')).toContainText('0%')
})
