import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

test('real auth, roles, settings, command lifecycle, diagnostics and WebGL', async ({
  page,
  playwright,
}) => {
  const base = process.env.E2E_BASE_URL!
  const owner = JSON.parse(
    await readFile(process.env.E2E_ACCOUNT_FILE!, 'utf8'),
  )
  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  const anonymous = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  })
  const operator = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  })
  try {
    expect(
      (
        await anonymous.patch('/api/v1/settings', {
          data: { device_id: 'room-01', co2_threshold: 1100 },
        })
      ).status(),
    ).toBe(401)
    await page.goto('/login')
    await page.getByLabel('Электронная почта').fill(owner.email)
    await page.getByLabel('Пароль', { exact: true }).fill('invalid-password')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByLabel('Пароль', { exact: true }).fill(owner.password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/auth/access')).json()).data
            ?.role,
      )
      .toBe('owner')
    console.info('E2E: browser login succeeded')
    await page.reload()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/auth/access')).json()).data
            ?.role,
      )
      .toBe('owner')
    expect(
      (await page.context().cookies()).some(
        (c) => c.httpOnly && c.sameSite === 'Lax',
      ),
    ).toBe(true)
    const credentials = {
      email: `user-${randomUUID()}@e2e.test`,
      password: owner.password,
      name: 'E2E user',
    }
    expect(
      (
        await operator.post('/api/auth/sign-up/email', { data: credentials })
      ).status(),
    ).toBe(200)
    expect(
      (
        await operator.patch('/api/v1/settings', {
          data: { device_id: 'room-01', automation_enabled: false },
        })
      ).status(),
    ).toBe(403)
    await db.query(
      `UPDATE aircheck_access_roles SET role='operator' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)`,
      [credentials.email],
    )
    expect(
      (
        await operator.patch('/api/v1/settings', {
          data: { device_id: 'room-01', automation_enabled: false },
        })
      ).status(),
    ).toBe(200)
    expect(
      (await (await page.request.get('/api/v1/settings')).json()).data
        .automation_enabled,
    ).toBe(false)
    console.info('E2E: roles and settings succeeded')
    const sent = await operator.post('/api/v1/controls/ventilation', {
      data: { device_id: 'room-01', action: 'on' },
    })
    expect(sent.status()).toBe(202)
    const commands = (await sent.json()).data.commands
    expect(commands).toHaveLength(2)
    await expect
      .poll(
        async () => {
          const result = await db.query(
            'SELECT status FROM actuator_commands WHERE id=ANY($1::bigint[])',
            [commands.map((c: { id: number }) => c.id)],
          )
          return result.rows.map((r) => r.status)
        },
        { timeout: 30_000 },
      )
      .toEqual(['applied', 'applied'])
    console.info('E2E: actual device ACK succeeded')
    const pending = await operator.post('/api/v1/controls/ventilation', {
      data: { device_id: 'isolated-e2e', action: 'on' },
    })
    expect(pending.status()).toBe(202)
    const id = (await pending.json()).data.commands[0].id
    expect(
      (
        await operator.post('/api/v1/controls/commands/actions', {
          data: { device_id: 'isolated-e2e', id, action: 'cancel' },
        })
      ).status(),
    ).toBe(200)
    expect(
      (await db.query('SELECT status FROM actuator_commands WHERE id=$1', [id]))
        .rows[0].status,
    ).toBe('cancelled')
    const expires = await operator.post('/api/v1/controls/ventilation', {
      data: { device_id: 'expired-e2e', action: 'on' },
    })
    expect(expires.status()).toBe(202)
    await db.query(
      `UPDATE actuator_commands SET expires_at=clock_timestamp()-interval '1 second' WHERE device_id='expired-e2e'`,
    )
    await anonymous.get('/api/v1/controls?device_id=expired-e2e')
    expect(
      (
        await db.query(
          `SELECT DISTINCT status FROM actuator_commands WHERE device_id='expired-e2e'`,
        )
      ).rows,
    ).toEqual([{ status: 'expired' }])
    for (let i = 120; i >= 0; i--) {
      const response = await anonymous.post('/api/v1/measurements', {
        headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
        data: {
          data_source: 'simulator',
          timestamp: new Date(Date.now() - i * 60_000).toISOString(),
          indoor: { co2: 950, temperature: 23, humidity: 45, pm25: 5 },
          outdoor: { temperature: 18, humidity: 60, pm25: 8 },
          window_open: false,
        },
      })
      expect(response.status()).toBe(201)
      if (i === 0) {
        const point = (await response.json()).data
        expect(point.prediction_status).toBe('ready')
        expect(point.prediction.measurement_id).toBe(point.id)
      }
    }
    await page.goto('/#settings')
    await expect(
      page.getByRole('checkbox', { name: /^Автоматическое управление/ }),
    ).not.toBeChecked()
    await page.getByText('Автоматическое управление', { exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: /^Автоматическое управление/ }),
    ).toBeChecked()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(
      page.getByText('Настройки сохранены и применены к локальному узлу.', {
        exact: true,
      }),
    ).toBeVisible()
    expect(
      (await (await page.request.get('/api/v1/settings')).json()).data
        .automation_enabled,
    ).toBe(true)
    const qualityTarget = new Date(Date.now() - 5 * 60_000)
    await db.query(
      `INSERT INTO measurements(timestamp,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source) VALUES ($1,850,23,45,5,18,60,8,false,'real')`,
      [new Date(qualityTarget.getTime() + 45_000)],
    )
    await db.query(
      `INSERT INTO predictions(target_time,predicted_co2,model_name,model_version,source_timestamp,data_source) VALUES ($1,950,'test','quality-test',$1::timestamptz-interval '15 minutes','real'),($2,2000,'test','quality-test',$2::timestamptz-interval '15 minutes','real')`,
      [qualityTarget, new Date(Date.now() - 30 * 60_000)],
    )
    await db.query(
      `INSERT INTO measurements(timestamp,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source) VALUES (clock_timestamp(),850,23,45,5,18,60,8,false,'real')`,
    )
    await db.query(
      `INSERT INTO predictions(target_time,predicted_co2,model_name,model_version,source_timestamp,data_source) VALUES (clock_timestamp()+interval '30 seconds',950,'test','quality-test',clock_timestamp()-interval '15 minutes','real')`,
    )
    const quality = (await (await page.request.get('/api/v1/model')).json())
      .data.quality.groups
    expect(
      quality.find(
        (g: { source: string; model_version: string }) =>
          g.source === 'real' && g.model_version === 'quality-test',
      ),
    ).toMatchObject({ matches: 1, mae: 100, rmse: 100 })
    expect(
      (
        await operator.post('/api/v1/model', {
          data: { action: 'train', source: 'simulator' },
        })
      ).status(),
    ).toBe(403)
    await page.getByRole('tab', { name: 'Технические сведения' }).click()
    const modelPanel = page.getByLabel('Управление ML-моделью')
    await expect(
      modelPanel.getByRole('button', { name: 'Обучить модель' }),
    ).toBeEnabled()
    await modelPanel.getByLabel('Данные для обучения').selectOption('simulator')
    await modelPanel.getByRole('button', { name: 'Обучить модель' }).click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/v1/model')).json()).data.model
            .model_version,
      )
      .not.toBe('1.0')
    await expect(
      modelPanel.getByText('Обучение завершено', { exact: true }),
    ).toBeVisible()
    const trained = (await (await page.request.get('/api/v1/model')).json())
      .data.model.model_version
    expect(trained).not.toBe('1.0')
    const newPrediction = await anonymous.post('/api/v1/measurements', {
      headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
      data: {
        data_source: 'simulator',
        timestamp: new Date().toISOString(),
        indoor: { co2: 950, temperature: 23, humidity: 45, pm25: 5 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        window_open: false,
      },
    })
    expect(newPrediction.status()).toBe(201)
    expect((await newPrediction.json()).data.prediction.model_version).toBe(
      trained,
    )

    await modelPanel.getByLabel('Данные для обучения').selectOption('real')
    await modelPanel.getByRole('button', { name: 'Обучить модель' }).click()
    await expect(
      modelPanel.getByText('Ошибка обучения', { exact: true }),
    ).toBeVisible()
    expect(
      (await (await page.request.get('/api/v1/model')).json()).data.model
        .model_version,
    ).toBe(trained)
    await modelPanel
      .getByRole('button', { name: 'Вернуть предыдущую модель' })
      .click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/v1/model')).json()).data.model
            .model_version,
      )
      .toBe('1.0')
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (width === 1920 || width === 320)
        await page.screenshot({
          path: `../tests/browser/artifacts/model-${width}.png`,
          fullPage: true,
        })
    }
    console.info(
      'E2E: owner training, failed training preserves model and rollback succeeded',
    )
    expect((await anonymous.get('/api/v1/history?days=30')).status()).toBe(401)
    await page.goto('/#history')
    const archive = page.getByLabel('Долгосрочная история')
    await archive.getByRole('button', { name: '30 дней', exact: true }).click()
    await expect(
      archive.getByRole('link', { name: 'Скачать CSV' }),
    ).toBeVisible()
    const month = (
      await (
        await page.request.get('/api/v1/history?days=30&source=simulator')
      ).json()
    ).data
    expect(month.summary.samples).toBeGreaterThan(100)
    expect(month.summary.metrics.co2.average).toBeGreaterThan(0)
    expect(month.summary.totals.covered_seconds).toBeLessThan(30 * 86400)
    const downloadPromise = page.waitForEvent('download')
    await archive.getByRole('link', { name: 'Скачать CSV' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('aircheck-30days.csv')
    const csv = await readFile((await download.path())!, 'utf8')
    expect(csv).toContain('hour_utc')
    expect(csv).toContain('ug/m3')
    expect(csv).toContain('simulator')
    const late = await anonymous.post('/api/v1/measurements', {
      headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
      data: {
        timestamp: new Date(Date.now() - 26 * 3600_000).toISOString(),
        indoor: { co2: 950, temperature: 23, humidity: 45, pm25: 5 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        window_open: false,
      },
    })
    expect(late.status()).toBe(422)
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (width === 320)
        await page.screenshot({
          path: '../tests/browser/artifacts/history-320.png',
          fullPage: true,
        })
    }
    console.info(
      'E2E: monthly aggregate history, CSV and late-data policy succeeded',
    )
    expect(
      (
        await operator.patch('/api/v1/notifications', {
          data: { enabled: false },
        })
      ).status(),
    ).toBe(403)
    expect((await anonymous.get('/api/v1/events')).status()).toBe(401)
    await page.goto('/#settings')
    await page.getByRole('tab', { name: 'Технические сведения' }).click()
    const channelPanel = page.getByLabel('Настройки уведомлений')
    await channelPanel.getByLabel('Длительность превышения CO₂, сек').fill('1')
    await channelPanel.getByLabel('Длительность потери связи, сек').fill('1')
    await channelPanel
      .getByRole('button', { name: 'Сохранить уведомления', exact: true })
      .click()
    await expect(
      channelPanel.getByText('Настройки уведомлений сохранены', {
        exact: true,
      }),
    ).toBeVisible()
    async function postPoint(co2: number) {
      const response = await anonymous.post('/api/v1/measurements', {
        headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
        data: {
          data_source: 'simulator',
          timestamp: new Date().toISOString(),
          indoor: { co2, temperature: 23, humidity: 45, pm25: 5 },
          outdoor: { temperature: 18, humidity: 60, pm25: 8 },
          window_open: false,
        },
      })
      expect(response.status()).toBe(201)
    }
    expect(
      (
        await page.request.post('/api/simulator/actions', {
          data: {
            action: 'scenario',
            payload: { scenario_id: 'backend_offline' },
          },
          headers: { Origin: base },
        })
      ).status(),
    ).toBe(202)
    await page.waitForTimeout(500)
    await postPoint(1500)
    await page.request.get('/api/v1/events')
    await page.waitForTimeout(1500)
    let events = (await (await page.request.get('/api/v1/events')).json()).data
    expect(
      events.filter((e: { kind: string }) => e.kind === 'co2_high'),
    ).toHaveLength(1)
    for (let i = 0; i < 3; i++) await page.request.get('/api/v1/events')
    events = (await (await page.request.get('/api/v1/events')).json()).data
    expect(
      events.filter((e: { kind: string }) => e.kind === 'co2_high'),
    ).toHaveLength(1)
    await postPoint(700)
    events = (await (await page.request.get('/api/v1/events')).json()).data
    expect(
      events.some(
        (e: { kind: string; message: string }) =>
          e.kind === 'recovery' && e.message.includes('CO₂'),
      ),
    ).toBe(true)
    expect(
      (
        await page.request.post('/api/simulator/actions', {
          data: { action: 'scenario', payload: { scenario_id: 'normal_room' } },
          headers: { Origin: base },
        })
      ).status(),
    ).toBe(202)
    const failedCommand = (
      await db.query(
        `INSERT INTO actuator_commands(device_id,target,desired_state,source,reason,batch_id,status,failure_reason,completed_at) VALUES('room-01','intake',false,'manual','E2E fixture',$1,'failed','Тестовый отказ мотора',clock_timestamp()) RETURNING id`,
        [randomUUID()],
      )
    ).rows[0].id
    events = (await (await page.request.get('/api/v1/events')).json()).data
    expect(
      events.filter((e: { kind: string }) => e.kind === 'command_failed'),
    ).toHaveLength(1)
    const retry = await operator.post('/api/v1/controls/commands/actions', {
      data: {
        device_id: 'room-01',
        id: Number(failedCommand),
        action: 'retry',
      },
    })
    expect(retry.status()).toBe(200)
    const retried = (await retry.json()).data.commands[0].id
    await expect
      .poll(
        async () =>
          (
            await db.query('SELECT status FROM actuator_commands WHERE id=$1', [
              retried,
            ])
          ).rows[0].status,
      )
      .toBe('applied')
    events = (await (await page.request.get('/api/v1/events')).json()).data
    expect(
      events.some(
        (e: { kind: string; message: string }) =>
          e.kind === 'recovery' && e.message.includes('команды'),
      ),
    ).toBe(true)
    await page.goto('/#controls')
    const journal = page.getByLabel('Журнал событий')
    await expect(journal.getByText(/Тестовый отказ мотора/)).toBeVisible()
    await journal
      .getByRole('button', { name: /Отметить событие/ })
      .first()
      .click()
    await expect(
      journal.getByText('Прочитано', { exact: true }).first(),
    ).toBeVisible()
    const readId = (
      await db.query(
        `SELECT r.event_id FROM notification_reads r JOIN "user" u ON u.id=r.user_id WHERE u.email=$1 ORDER BY r.read_at DESC LIMIT 1`,
        [owner.email],
      )
    ).rows[0].event_id
    const otherEvents = (await (await operator.get('/api/v1/events')).json())
      .data
    expect(
      otherEvents.find((e: { id: number }) => e.id === Number(readId)).read,
    ).toBe(false)
    console.info(
      'E2E: CO2/command alerts, deduplication, recovery, read marks and permissions succeeded',
    )
    await page.goto('/#controls')
    await expect(
      page.getByRole('heading', { name: 'История команд' }),
    ).toBeVisible()
    await page.goto('/')
    await expect(page.getByLabel('Актуальность данных')).toBeVisible()
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true)
    await page.setViewportSize({ width: 1440, height: 1080 })
    console.info('E2E: lifecycle, dashboard and responsive checks succeeded')
    await page.goto('/simulator')
    const canvas = page
      .getByRole('application', {
        name: 'Интерактивная 3D-сцена стенда AirCheck',
      })
      .locator('canvas')
    await expect(canvas).toBeVisible()
    expect(
      await canvas.evaluate(
        (element: HTMLCanvasElement) =>
          !!(element.getContext('webgl2') || element.getContext('webgl')),
      ),
    ).toBe(true)
    const focus = page.getByRole('button', {
      name: 'Сфокусировать камеру на выбранном устройстве',
    })
    const bounds = (await canvas.boundingBox())!
    // Raycast actual rendered objects, never a DOM stand-in for the scene.
    for (let y = 0.25; y < 0.9 && !(await focus.isEnabled()); y += 0.1)
      for (let x = 0.15; x < 0.9 && !(await focus.isEnabled()); x += 0.1) {
        await page.mouse.click(
          bounds.x + bounds.width * x,
          bounds.y + bounds.height * y,
        )
        await page.waitForTimeout(100)
      }
    await expect(focus).toBeEnabled()
    await focus.click()
    await expect(page.locator('.sim-device-chip')).toBeVisible()
    process.kill(Number(process.env.E2E_SIMULATOR_PID), 'SIGTERM')
    process.kill(Number(process.env.E2E_ML_PID), 'SIGTERM')
    await page.waitForTimeout(1500)
    const failed = await anonymous.post('/api/v1/measurements', {
      headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
      data: {
        data_source: 'simulator',
        timestamp: new Date().toISOString(),
        indoor: { co2: 950, temperature: 23, humidity: 45, pm25: 5 },
        outdoor: { temperature: 18, humidity: 60, pm25: 8 },
        window_open: false,
      },
    })
    expect(failed.status()).toBe(201)
    expect((await failed.json()).data.prediction).toBeNull()
    const dashboard = (
      await (await anonymous.get('/api/v1/measurements/latest')).json()
    ).data
    expect(dashboard.prediction).toBeNull()
    expect(dashboard.diagnostics.prediction).toBe('unavailable')
    await page.goto('/')
    await expect(
      page
        .getByLabel('Актуальность данных')
        .getByText('ML недоступен', { exact: true }),
    ).toBeVisible()
    await db.query(
      `UPDATE actuator_states SET last_reported_at=clock_timestamp()-interval '10 minutes'`,
    )
    await page.request.get('/api/v1/events')
    await page.waitForTimeout(1500)
    let offlineEvents = (
      await (await page.request.get('/api/v1/events')).json()
    ).data
    expect(
      offlineEvents.filter(
        (e: { kind: string }) => e.kind === 'device_offline',
      ),
    ).toHaveLength(1)
    const reported = (await (await page.request.get('/api/v1/controls')).json())
      .data.reported
    expect(
      (
        await anonymous.post('/api/v1/controls/state', {
          headers: { Authorization: 'Bearer ' + process.env.DEVICE_API_TOKEN },
          data: {
            device_id: 'room-01',
            timestamp: new Date().toISOString(),
            ...reported,
            applied_command_ids: [],
          },
        })
      ).status(),
    ).toBe(200)
    offlineEvents = (await (await page.request.get('/api/v1/events')).json())
      .data
    expect(
      offlineEvents.some(
        (e: { kind: string; message: string }) =>
          e.kind === 'recovery' && e.message.includes('Связь'),
      ),
    ).toBe(true)
    await page.goto('/#settings')
    await page.getByRole('tab', { name: 'Технические сведения' }).click()
    const deliveryPanel = page.getByLabel('Настройки уведомлений')
    const fakeToken = '123456:' + randomUUID().replaceAll('-', '')
    await deliveryPanel.getByLabel('Telegram Chat ID').fill('-10042')
    await deliveryPanel.getByLabel('Новый токен Telegram-бота').fill(fakeToken)
    await deliveryPanel
      .getByRole('button', { name: 'Сохранить уведомления', exact: true })
      .click()
    await expect(
      deliveryPanel.getByText(
        'Токен сохранён; его значение не возвращается в панель.',
        { exact: true },
      ),
    ).toBeVisible()
    const saved = await page.request.get('/api/v1/notifications')
    expect(await saved.text()).not.toContain(fakeToken)
    const stored = (
      await db.query('SELECT token_ciphertext FROM notification_settings')
    ).rows[0].token_ciphertext
    expect(stored).not.toContain(fakeToken)
    expect(stored).not.toBeNull()
    expect(
      (
        await page.request.post('/api/v1/notifications', {
          data: { chat_id: '-10099' },
          headers: { Origin: base },
        })
      ).status(),
    ).toBe(400)
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (width === 320) {
        await deliveryPanel.scrollIntoViewIfNeeded()
        await page.screenshot({
          path: '../tests/browser/artifacts/notifications-320.png',
        })
      }
    }
    await deliveryPanel
      .getByRole('button', { name: 'Сохранить уведомления', exact: true })
      .focus()
    await page.keyboard.press('Tab')
    await expect(
      deliveryPanel.getByRole('button', {
        name: 'Отправить тест в выбранный чат',
      }),
    ).toBeFocused()
    await page.setViewportSize({ width: 1440, height: 1080 })
    await deliveryPanel
      .getByRole('button', { name: 'Отправить тест в выбранный чат' })
      .click()
    await expect(
      deliveryPanel.getByText(
        'Тест поставлен в очередь выбранного чата. Результат появится в журнале событий.',
        { exact: true },
      ),
    ).toBeVisible()
    const testEvent = (
      await db.query(
        `SELECT id FROM notification_events WHERE kind='channel_test' ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0].id
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.query(
        `UPDATE notification_events SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND delivery_status='pending'`,
        [testEvent],
      )
      await expect
        .poll(
          async () =>
            (
              await db.query(
                'SELECT attempts FROM notification_events WHERE id=$1',
                [testEvent],
              )
            ).rows[0].attempts,
          { timeout: 20_000 },
        )
        .toBe(attempt)
      await expect
        .poll(
          async () =>
            (
              await db.query(
                'SELECT delivery_status FROM notification_events WHERE id=$1',
                [testEvent],
              )
            ).rows[0].delivery_status,
          { timeout: 20_000 },
        )
        .toBe(attempt === 3 ? 'sent' : 'pending')
    }
    const stub = await (
      await anonymous.get(process.env.E2E_TELEGRAM_URL! + '/stats')
    ).json()
    expect(stub).toMatchObject({ calls: 3, successes: 1, valid_chat: true })
    expect(
      (
        await db.query(
          'SELECT delivery_error FROM notification_events WHERE id=$1',
          [testEvent],
        )
      ).rows[0].delivery_error,
    ).toBeNull()
    await anonymous.post(process.env.E2E_TELEGRAM_URL! + '/mode', {
      data: { always_fail: true },
    })
    await deliveryPanel
      .getByRole('button', { name: 'Отправить тест в выбранный чат' })
      .click()
    await expect
      .poll(
        async () =>
          (
            await db.query(
              `SELECT count(*)::int AS count FROM notification_events WHERE kind='channel_test'`,
            )
          ).rows[0].count,
      )
      .toBe(2)
    const failedDelivery = (
      await db.query(
        `SELECT id FROM notification_events WHERE kind='channel_test' ORDER BY id DESC LIMIT 1`,
      )
    ).rows[0].id
    for (let attempt = 1; attempt <= 3; attempt++) {
      await db.query(
        `UPDATE notification_events SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1 AND delivery_status='pending'`,
        [failedDelivery],
      )
      await expect
        .poll(
          async () =>
            (
              await db.query(
                'SELECT attempts FROM notification_events WHERE id=$1',
                [failedDelivery],
              )
            ).rows[0].attempts,
          { timeout: 20_000 },
        )
        .toBe(attempt)
      await expect
        .poll(
          async () =>
            (
              await db.query(
                'SELECT delivery_status FROM notification_events WHERE id=$1',
                [failedDelivery],
              )
            ).rows[0].delivery_status,
          { timeout: 20_000 },
        )
        .toBe(attempt === 3 ? 'failed' : 'pending')
    }
    expect(
      (
        await db.query(
          'SELECT next_attempt_at FROM notification_events WHERE id=$1',
          [failedDelivery],
        )
      ).rows[0].next_attempt_at,
    ).toBeNull()
    expect(
      (
        await (
          await anonymous.get(process.env.E2E_TELEGRAM_URL! + '/stats')
        ).json()
      ).calls,
    ).toBe(6)
    await page.goto('/#controls')
    await expect(
      page.getByLabel('Журнал событий').getByText(/Доставлено/),
    ).toBeVisible()
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      if (width === 320)
        await page.screenshot({
          path: '../tests/browser/artifacts/events-320.png',
          fullPage: true,
        })
    }
    expect(
      (
        await page.request.patch('/api/v1/notifications', {
          data: { clear_token: true },
          headers: { Origin: base },
        })
      ).status(),
    ).toBe(200)
    expect(
      (await (await page.request.get('/api/v1/notifications')).json()).data
        .token_configured,
    ).toBe(false)
    expect(
      (await db.query('SELECT token_ciphertext FROM notification_settings'))
        .rows[0].token_ciphertext,
    ).toBeNull()
    console.info(
      'E2E: offline/recovery, encrypted credentials and bounded retry delivery through local controlled Telegram transport succeeded',
    )
    await page.goto('/')
    await db.query(
      `UPDATE measurements SET timestamp=timestamp-interval '10 minutes'; UPDATE actuator_states SET last_reported_at=clock_timestamp()-interval '10 minutes'`,
    )
    await page
      .getByRole('button', { name: 'Обновить показания', exact: true })
      .click()
    await expect(
      page
        .getByLabel('Актуальность данных')
        .getByText('Измерения устарели', { exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByLabel('Актуальность данных')
        .getByText('Устройство: не на связи', { exact: true }),
    ).toBeVisible()
    await page.locator('.account-menu summary').click()
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Выйти', exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/auth/access')).json()).data
            ?.role,
      )
      .toBe('guest')
    await page.reload()
    expect(
      (
        await page.request.patch('/api/v1/settings', {
          data: { device_id: 'room-01', automation_enabled: true },
          headers: { Origin: base },
        })
      ).status(),
    ).toBe(401)
  } finally {
    await anonymous.dispose()
    await operator.dispose()
    await db.end()
  }
})
