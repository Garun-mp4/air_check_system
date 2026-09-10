import type { AppConfig } from './config'
import type { NodeSettingsDefaults } from './types'

export function getNodeSettingsDefaults(config: AppConfig): NodeSettingsDefaults {
  return {
    automationEnabled: config.automationEnabled,
    autoWindowEnabled: config.autoWindowEnabled,
    manualOverrideMinutes: config.windowManualOverrideMinutes,
    autoVentilationMinimumMinutes: config.autoVentilationMinimumMinutes,
    co2NormalThreshold: config.co2NormalThreshold,
    co2CriticalThreshold: config.co2CriticalThreshold,
    pm25GoodLimit: config.pm25GoodLimit,
    pm25ElevatedLimit: config.pm25ElevatedLimit,
    alertsEnabled: config.alertsEnabled,
    retentionHours: config.dataRetentionHours,
  }
}
