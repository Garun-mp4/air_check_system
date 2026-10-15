"""Dataset admission report. Real-data readiness is evidence, not a claim of accuracy."""
from datetime import timedelta
from feature_schema import FeatureError, build_training_rows, flatten_measurement

def dataset_readiness(records, source, horizon_minutes=15):
    valid, rejected, duplicates = [], 0, 0
    seen = set()
    for record in records:
        if not isinstance(record, dict) or record.get('data_source', 'unknown') != source:
            continue
        try:
            flat = flatten_measurement(record)
            if flat['timestamp'] in seen:
                duplicates += 1
                continue
            seen.add(flat['timestamp']); valid.append(record)
        except (FeatureError, TypeError, ValueError):
            rejected += 1
    ordered = sorted((flatten_measurement(record) for record in valid), key=lambda item: item['timestamp'])
    hours = (ordered[-1]['timestamp'] - ordered[0]['timestamp']).total_seconds() / 3600 if ordered else 0
    gaps = sum(b['timestamp'] - a['timestamp'] > timedelta(minutes=2) for a, b in zip(ordered, ordered[1:]))
    rows = build_training_rows(valid, horizon_minutes)
    reasons = []
    if len(rows) < 30: reasons.append('Нужно не менее 30 полных строк с историей и будущим target')
    if source == 'real':
        if hours < 24: reasons.append('Нужно не менее 24 часов настоящих измерений')
        if len(rows) < 300: reasons.append('Нужно не менее 300 пригодных строк для реальной модели')
        if rejected: reasons.append('В выборке есть недостоверные или неполные измерения')
        if ordered and max(item['co2'] for item in ordered) - min(item['co2'] for item in ordered) < 200:
            reasons.append('Недостаточная изменчивость CO₂: нужны разные режимы помещения')
    return {'source': source, 'horizon_minutes': horizon_minutes, 'valid_measurements': len(valid), 'rejected': rejected,
        'duplicates': duplicates, 'span_hours': round(hours, 2), 'gaps_over_2min': gaps, 'training_rows': len(rows),
        'ready': not reasons, 'reasons': reasons,
        'next_steps': ['Собирать реальные данные при разных режимах окна и вентиляции', 'Проверить калибровку и время', 'Сравнить прогноз на отдельном последующем периоде и с baseline'] if source == 'real' else ['Симуляция проверяет программный контур; качество для физического помещения не подтверждено']}
