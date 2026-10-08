import json
import pytest

@pytest.fixture
def history_db(postgres_db):
    postgres_db.psql('TRUNCATE history_bridge, archived_air_stats,live_air_stats,history_watermark,measurements CASCADE;')
    yield postgres_db
    postgres_db.psql('TRUNCATE history_bridge, archived_air_stats,live_air_stats,history_watermark,measurements CASCADE;')

def insert(database,timestamp,co2=1000,limit=1000,source='real'):
    threshold='NULL' if limit is None else str(limit)
    return database.psql(f"""INSERT INTO measurements(timestamp,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on)
    VALUES('{timestamp}',{co2},23,45,40,18,60,8,true,'{source}',{threshold},35,true);""",check=False)

def rows(database,table='archived_air_stats'):
    result=database.psql(f"SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY bucket,data_source),'[]') FROM {table} s;")
    return json.loads(result.stdout.strip())

def test_partial_hour_retention_merge_and_repeat_are_exact(history_db):
    for timestamp,co2,limit in [('2026-10-07T11:30:00Z',1000,1000),('2026-10-07T11:30:30Z',900,800),('2026-10-07T11:31:00Z',600,1000)]:
        assert insert(history_db,timestamp,co2,limit).returncode==0
    history_db.psql("SELECT archive_air_history('2026-10-07T11:30:45Z','2026-10-08T12:00Z');")
    archived=rows(history_db)[0]; live=rows(history_db,'live_air_stats')[0]
    assert archived['samples']==2 and live['samples']==1
    assert archived['covered_seconds']==45 and live['covered_seconds']==15
    assert archived['co2_exceed_seconds']==45 and live['co2_exceed_seconds']==15
    history_db.psql("SELECT archive_air_history('2026-10-07T12:00Z','2026-10-08T12:00Z');")
    final=rows(history_db)
    assert final[0]['samples']==3 and final[0]['metric_sums']['co2']==2500
    assert final[0]['metric_minima']['co2']==600
    assert final[0]['covered_seconds']==60
    assert rows(history_db,'live_air_stats')==[]
    history_db.psql("SELECT archive_air_history('2026-10-07T12:00Z','2026-10-08T12:00Z'); SELECT refresh_live_air_stats('2026-10-08T12:00Z');")
    assert rows(history_db)==final
    assert insert(history_db,'2026-10-07T11:59:59Z').returncode!=0
    assert insert(history_db,'2026-10-07T12:00:01Z').returncode==0

def test_midnight_split_null_extrema_gaps_and_unknown_threshold(history_db):
    assert insert(history_db,'2026-10-06T23:59:30Z',1200,None).returncode==0
    assert insert(history_db,'2026-10-07T00:00:30Z',600,1000).returncode==0
    assert insert(history_db,'2026-10-07T00:30:30Z',700,1000).returncode==0
    history_db.psql("SELECT archive_air_history('2026-10-07T00:00Z','2026-10-08T12:00Z');")
    split=rows(history_db)
    assert len(split)==1
    assert split[0]['covered_seconds']==30
    carry=rows(history_db,'live_air_stats')[0]
    assert carry['covered_seconds']==120
    assert split[0]['samples']==1
    assert sum(r['co2_known_seconds'] for r in split)==0
    history_db.psql("SELECT archive_air_history('2026-10-08T00:00Z','2026-10-08T12:00Z');")
    result=rows(history_db)
    assert result[1]['samples']==2 and result[1]['metric_minima']['co2']==600
    assert sum(r['covered_seconds'] for r in result)==150 # gap contributes only 90 seconds; unpaired last point contributes zero
    assert sum(r['co2_known_seconds'] for r in result)==90
    assert sum(r['co2_exceed_seconds'] for r in result)==0

def test_late_live_point_splits_boundary_carry_without_overlap(history_db):
    assert insert(history_db,'2026-10-07T11:30:30Z',1200,1000).returncode==0
    assert insert(history_db,'2026-10-07T11:31:00Z',600,1000).returncode==0
    history_db.psql("SELECT archive_air_history('2026-10-07T11:30:45Z','2026-10-08T12:00Z');")
    assert rows(history_db)[0]['covered_seconds']==15
    assert insert(history_db,'2026-10-07T11:30:50Z',600,1000).returncode==0
    history_db.psql("SELECT refresh_live_air_stats('2026-10-08T12:00Z');")
    live=rows(history_db,'live_air_stats')[0]
    assert live['covered_seconds']==15 # carry 5s + late point 10s
    assert live['co2_exceed_seconds']==5
    assert live['samples']==2 # carry is not an extra measurement
    history_db.psql("SELECT archive_air_history('2026-10-07T12:00Z','2026-10-08T12:00Z');")
    archived=rows(history_db)[0]
    assert archived['covered_seconds']==30
    assert archived['co2_exceed_seconds']==20
    assert archived['samples']==3
