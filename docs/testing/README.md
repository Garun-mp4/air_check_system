
# Проверки реализации

Milestones завершались последовательно с проверками перед переходом к следующему:

- [M1: команды](reports/m1-command-lifecycle.md)
- [M2: наружный воздух](reports/m2-outdoor-policy.md)
- [M3: актуальность прогнозов](reports/m3-prediction-provenance.md)
- [M4: браузерные проверки](reports/m4-browser-e2e.md)
- [M5: управление моделью](reports/m5-model-management.md)
- [M6: архив и CSV](reports/m6-long-term-history.md)
- [M7: события и Telegram](reports/m7-notifications.md)

## Реальный браузер

Обязательный браузерный набор и CI описаны в [browser-e2e.md](browser-e2e.md). Запуск: `python tests/browser/run.py` после production build, из окружения с установленными Python-зависимостями. Рабочая база не используется.
