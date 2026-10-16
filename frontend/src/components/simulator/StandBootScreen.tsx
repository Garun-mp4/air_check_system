'use client'

import Link from 'next/link'
import BrandLogo from '../BrandLogo'
import type { SimulatorBootStage } from './boot-state'
import styles from './StandBootScreen.module.css'

type StandBootScreenProps = {
  stage: SimulatorBootStage | 'route' | 'error'
  errorMessage?: string
  onRetry?: () => void
}

const stepLabels = [
  'Получение состояния системы',
  'Подготовка 3D-сцены',
  'Запуск WebGL и первый кадр',
]

function getActiveStep(stage: StandBootScreenProps['stage']): number {
  if (stage === 'snapshot') return 0
  if (stage === 'scene') return 1
  if (stage === 'frame') return 2
  return -1
}

function getTitle(stage: StandBootScreenProps['stage'], hasError: boolean): string {
  if (stage === 'route') return 'Открываем 3D-стенд'
  if (stage === 'error') return 'Не удалось запустить 3D-стенд'
  if (stage === 'snapshot' && hasError) return 'Ожидаем связь с системой'
  if (stage === 'snapshot') return 'Подключаем данные системы'
  if (stage === 'scene') return 'Готовим 3D-сцену'
  return 'Прорисовываем стенд'
}

function getDescription(stage: StandBootScreenProps['stage'], hasError: boolean): string {
  if (stage === 'route') return 'Открываем раздел цифрового стенда.'
  if (stage === 'error') return 'Перезапустите сцену или вернитесь к панели управления.'
  if (stage === 'snapshot' && hasError) return 'Первый снимок системы ещё не получен. Повторное подключение выполняется автоматически.'
  if (stage === 'snapshot') return 'Получаем и проверяем актуальное состояние системы.'
  if (stage === 'scene') return 'Загружаем компоненты сцены и инициализируем 3D-движок.'
  return 'Рендерер запущен. Ожидаем первый кадр сцены.'
}

export default function StandBootScreen({ stage, errorMessage, onRetry }: StandBootScreenProps) {
  const activeStep = getActiveStep(stage)
  const hasError = Boolean(errorMessage)
  const showSteps = activeStep >= 0

  return (
    <div className={styles.screen} aria-busy={stage !== 'error'}>
      <section className={styles.card} aria-labelledby="stand-boot-title">
        <div className={styles.brand}>
          <BrandLogo className={styles.logo} width={34} height={26} priority />
          <span>AirCheck</span>
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.brandSubtitle}>3D-стенд</span>
        </div>

        <div className={styles.heading}>
          <span className={`${styles.spinner} ${stage === 'error' ? styles.spinnerStopped : ''}`} aria-hidden="true" />
          <div>
            <p className={styles.eyebrow}>Цифровой стенд</p>
            <h1 id="stand-boot-title">{getTitle(stage, hasError)}</h1>
            <p className={styles.description} role="status" aria-live="polite" aria-atomic="true">
              {getDescription(stage, hasError)}
            </p>
          </div>
        </div>

        {showSteps ? (
          <ol className={styles.steps}>
            {stepLabels.map((label, index) => {
              const state = index < activeStep ? 'done' : index === activeStep ? 'active' : 'pending'
              return (
                <li className={`${styles.step} ${styles[`step${state[0].toUpperCase()}${state.slice(1)}`]}`} key={label} aria-current={state === 'active' ? 'step' : undefined}>
                  <span className={styles.stepMarker} aria-hidden="true">{state === 'done' ? '✓' : state === 'active' ? '·' : ''}</span>
                  <span className={styles.stepLabel}>{label}</span>
                  <span className={styles.stepState}>{state === 'done' ? 'Готово' : state === 'active' ? 'Выполняется' : 'Ожидает'}</span>
                </li>
              )
            })}
          </ol>
        ) : null}

        {errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : null}

        <div className={styles.actions}>
          {stage === 'error' ? onRetry
            ? <button className="sim-button sim-button-primary" type="button" onClick={onRetry}>Повторить запуск</button>
            : <a className="sim-button sim-button-primary" href="/simulator">Повторить запуск</a>
            : null}
          <Link className="sim-button" href="/">Вернуться к панели</Link>
        </div>
      </section>
    </div>
  )
}
