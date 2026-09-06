import type {
  Measurement,
  Prediction,
  RecommendationDraft,
} from './types'

export interface RecommendationThresholds {
  normal: number
  critical: number
}

function predictionValue(prediction: Prediction | number | null): number | null {
  if (prediction === null) {
    return null
  }
  return typeof prediction === 'number' ? prediction : prediction.predictedCo2
}

export function evaluateRecommendation(
  measurement: Measurement,
  prediction: Prediction | number | null,
  thresholds: RecommendationThresholds,
): RecommendationDraft {
  const currentCo2 = measurement.indoor.co2
  const predictedCo2 = predictionValue(prediction)

  if (currentCo2 >= thresholds.critical) {
    if (measurement.windowOpen) {
      return {
        type: 'ventilating',
        message: 'Продолжайте проветривание помещения',
        durationMinutes: 10,
        reason:
          'Текущий уровень CO₂ выше критического порога, окно уже открыто.',
      }
    }
    return {
      type: 'ventilate_now',
      message: 'Откройте окно и проветрите помещение',
      durationMinutes: 10,
      reason:
        'Текущий уровень CO₂ выше критического порога ' +
        thresholds.critical +
        ' ppm.',
    }
  }

  if (predictedCo2 !== null && predictedCo2 >= thresholds.critical) {
    if (measurement.windowOpen) {
      return {
        type: 'ventilating',
        message: 'Оставьте окно открытым ещё на несколько минут',
        durationMinutes: 5,
        reason:
          'Прогноз на 15 минут остаётся выше критического уровня, но проветривание уже идёт.',
      }
    }
    return {
      type: 'forecast_warning',
      message: 'Скоро потребуется проветривание',
      durationMinutes: 5,
      reason:
        'Модель прогнозирует превышение критического порога CO₂ через 15 минут.',
    }
  }

  if (currentCo2 >= thresholds.normal) {
    if (measurement.windowOpen) {
      return {
        type: 'ventilating',
        message: 'Проветривание снижает уровень CO₂',
        durationMinutes: 5,
        reason:
          'Текущий уровень CO₂ выше комфортной зоны, окно открыто.',
      }
    }
    return {
      type: 'monitor',
      message: 'Следите за уровнем CO₂',
      durationMinutes: null,
      reason:
        'Текущий уровень CO₂ выше комфортного порога ' +
        thresholds.normal +
        ' ppm.',
    }
  }

  if (predictedCo2 !== null && predictedCo2 >= thresholds.normal) {
    return {
      type: 'forecast_warning',
      message: 'Показатель CO₂ может выйти из комфортной зоны',
      durationMinutes: 5,
      reason:
        'Прогноз на 15 минут выше комфортного порога, хотя текущий уровень ещё в норме.',
    }
  }

  return {
    type: 'normal',
    message: 'Показатели в норме, проветривание не требуется',
    durationMinutes: null,
    reason: 'Текущий и прогнозируемый уровень CO₂ находятся в комфортной зоне.',
  }
}
