-- Preserve expired contributions separately from the recomputed live snapshot.
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS co2_limit DOUBLE PRECISION;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS pm25_limit DOUBLE PRECISION;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS ventilation_on BOOLEAN;
CREATE TABLE IF NOT EXISTS history_watermark (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), cutoff TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS archived_air_stats (bucket TIMESTAMPTZ NOT NULL, data_source TEXT NOT NULL,
 samples BIGINT NOT NULL, metric_sums JSONB NOT NULL, metric_minima JSONB NOT NULL, metric_maxima JSONB NOT NULL,
 covered_seconds DOUBLE PRECISION NOT NULL, co2_known_seconds DOUBLE PRECISION NOT NULL,
 pm25_known_seconds DOUBLE PRECISION NOT NULL, co2_exceed_seconds DOUBLE PRECISION NOT NULL,
 pm25_exceed_seconds DOUBLE PRECISION NOT NULL, window_seconds DOUBLE PRECISION NOT NULL,
 ventilation_seconds DOUBLE PRECISION NOT NULL, ventilation_known_seconds DOUBLE PRECISION NOT NULL,
 PRIMARY KEY(bucket,data_source));
CREATE TABLE IF NOT EXISTS live_air_stats (LIKE archived_air_stats INCLUDING ALL);
CREATE TABLE IF NOT EXISTS history_bridge (sample_at TIMESTAMPTZ NOT NULL, start_at TIMESTAMPTZ NOT NULL, indoor_co2 DOUBLE PRECISION,indoor_temperature DOUBLE PRECISION,indoor_humidity DOUBLE PRECISION,indoor_pm25 DOUBLE PRECISION,outdoor_temperature DOUBLE PRECISION,outdoor_humidity DOUBLE PRECISION,outdoor_pm25 DOUBLE PRECISION,window_open BOOLEAN,data_source TEXT PRIMARY KEY,co2_limit DOUBLE PRECISION,pm25_limit DOUBLE PRECISION,ventilation_on BOOLEAN);


CREATE OR REPLACE FUNCTION air_stats_rows(input_cutoff TIMESTAMPTZ, assessed TIMESTAMPTZ)
RETURNS TABLE(bucket TIMESTAMPTZ, data_source TEXT,
 samples BIGINT, metric_sums JSONB, metric_minima JSONB, metric_maxima JSONB,
 covered_seconds DOUBLE PRECISION, co2_known_seconds DOUBLE PRECISION,
 pm25_known_seconds DOUBLE PRECISION, co2_exceed_seconds DOUBLE PRECISION,
 pm25_exceed_seconds DOUBLE PRECISION, window_seconds DOUBLE PRECISION,
 ventilation_seconds DOUBLE PRECISION, ventilation_known_seconds DOUBLE PRECISION) LANGUAGE SQL STABLE AS $$
 WITH inputs AS (
   SELECT id,timestamp,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on,TRUE AS is_real_sample,timestamp+interval '90 seconds' AS expiry FROM measurements WHERE timestamp<=assessed
   UNION ALL SELECT -1,start_at,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on,FALSE,sample_at+interval '90 seconds' FROM history_bridge WHERE start_at<=assessed
 ), ordered AS (
   SELECT m.*,lead(timestamp) OVER(PARTITION BY data_source ORDER BY timestamp,id) AS next_at FROM inputs m
 ), spans AS (
   SELECT *,least(coalesce(next_at,timestamp),expiry,assessed,coalesce(input_cutoff,assessed)) AS end_at
   FROM ordered WHERE (input_cutoff IS NULL OR timestamp<input_cutoff)
 ), contributions AS (
   SELECT m.*,h AS hour_bucket, is_real_sample AND timestamp>=h AND timestamp<h+interval '1 hour' AS is_sample,
     greatest(0,extract(epoch FROM least(end_at,h+interval '1 hour')-greatest(timestamp,h)))::double precision AS seconds
   FROM spans m CROSS JOIN LATERAL generate_series(date_trunc('hour',timestamp,'UTC'),
     date_trunc('hour',greatest(timestamp,end_at-interval '1 microsecond'),'UTC'),interval '1 hour') h
 ) SELECT hour_bucket,data_source,count(*) FILTER(WHERE is_sample),jsonb_build_object('co2',coalesce(sum(indoor_co2) FILTER(WHERE is_sample),0),'temperature',coalesce(sum(indoor_temperature) FILTER(WHERE is_sample),0),'humidity',coalesce(sum(indoor_humidity) FILTER(WHERE is_sample),0),'pm25',coalesce(sum(indoor_pm25) FILTER(WHERE is_sample),0),'outdoor_temperature',coalesce(sum(outdoor_temperature) FILTER(WHERE is_sample),0),'outdoor_humidity',coalesce(sum(outdoor_humidity) FILTER(WHERE is_sample),0),'outdoor_pm25',coalesce(sum(outdoor_pm25) FILTER(WHERE is_sample),0)),jsonb_build_object('co2',min(indoor_co2) FILTER(WHERE is_sample),'temperature',min(indoor_temperature) FILTER(WHERE is_sample),'humidity',min(indoor_humidity) FILTER(WHERE is_sample),'pm25',min(indoor_pm25) FILTER(WHERE is_sample),'outdoor_temperature',min(outdoor_temperature) FILTER(WHERE is_sample),'outdoor_humidity',min(outdoor_humidity) FILTER(WHERE is_sample),'outdoor_pm25',min(outdoor_pm25) FILTER(WHERE is_sample)),jsonb_build_object('co2',max(indoor_co2) FILTER(WHERE is_sample),'temperature',max(indoor_temperature) FILTER(WHERE is_sample),'humidity',max(indoor_humidity) FILTER(WHERE is_sample),'pm25',max(indoor_pm25) FILTER(WHERE is_sample),'outdoor_temperature',max(outdoor_temperature) FILTER(WHERE is_sample),'outdoor_humidity',max(outdoor_humidity) FILTER(WHERE is_sample),'outdoor_pm25',max(outdoor_pm25) FILTER(WHERE is_sample)),
 sum(seconds),sum(CASE WHEN co2_limit IS NOT NULL THEN seconds ELSE 0 END),
 sum(CASE WHEN pm25_limit IS NOT NULL THEN seconds ELSE 0 END),
 sum(CASE WHEN indoor_co2>=co2_limit THEN seconds ELSE 0 END),
 sum(CASE WHEN indoor_pm25>=pm25_limit THEN seconds ELSE 0 END),
 sum(CASE WHEN window_open THEN seconds ELSE 0 END),
 sum(CASE WHEN ventilation_on THEN seconds ELSE 0 END),
 sum(CASE WHEN ventilation_on IS NOT NULL THEN seconds ELSE 0 END)
 FROM contributions GROUP BY hour_bucket,data_source;
$$;

CREATE OR REPLACE FUNCTION archive_air_history(input_cutoff TIMESTAMPTZ, assessed TIMESTAMPTZ DEFAULT clock_timestamp())
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE effective TIMESTAMPTZ; deleted INTEGER;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('aircheck-history'));
 SELECT greatest(input_cutoff,coalesce((SELECT cutoff FROM history_watermark WHERE singleton),input_cutoff)) INTO effective;
 INSERT INTO archived_air_stats SELECT * FROM air_stats_rows(effective,assessed)
 ON CONFLICT(bucket,data_source) DO UPDATE SET
 samples=archived_air_stats.samples+excluded.samples,
 metric_sums=(SELECT jsonb_object_agg(n.key,(n.value #>> '{}')::double precision+(archived_air_stats.metric_sums->>n.key)::double precision) FROM jsonb_each(excluded.metric_sums) n),
 metric_minima=(SELECT jsonb_object_agg(n.key,least((n.value #>> '{}')::double precision,(archived_air_stats.metric_minima->>n.key)::double precision)) FROM jsonb_each(excluded.metric_minima) n),
 metric_maxima=(SELECT jsonb_object_agg(n.key,greatest((n.value #>> '{}')::double precision,(archived_air_stats.metric_maxima->>n.key)::double precision)) FROM jsonb_each(excluded.metric_maxima) n),
 covered_seconds=archived_air_stats.covered_seconds+excluded.covered_seconds,
 co2_known_seconds=archived_air_stats.co2_known_seconds+excluded.co2_known_seconds,
 pm25_known_seconds=archived_air_stats.pm25_known_seconds+excluded.pm25_known_seconds,
 co2_exceed_seconds=archived_air_stats.co2_exceed_seconds+excluded.co2_exceed_seconds,
 pm25_exceed_seconds=archived_air_stats.pm25_exceed_seconds+excluded.pm25_exceed_seconds,
 window_seconds=archived_air_stats.window_seconds+excluded.window_seconds,
 ventilation_seconds=archived_air_stats.ventilation_seconds+excluded.ventilation_seconds,
 ventilation_known_seconds=archived_air_stats.ventilation_known_seconds+excluded.ventilation_known_seconds;
 -- Retain the expired boundary sample as a non-sample carry, recomputed with late live arrivals.
 INSERT INTO history_bridge(sample_at,start_at,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on)
 SELECT sample_at,effective,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on FROM (
   SELECT DISTINCT ON(data_source) * FROM (
     SELECT timestamp AS sample_at,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on FROM measurements WHERE timestamp<effective
     UNION ALL SELECT sample_at,indoor_co2,indoor_temperature,indoor_humidity,indoor_pm25,outdoor_temperature,outdoor_humidity,outdoor_pm25,window_open,data_source,co2_limit,pm25_limit,ventilation_on FROM history_bridge
   ) candidates ORDER BY data_source,sample_at DESC
 ) latest WHERE sample_at+interval '90 seconds'>effective
 ON CONFLICT(data_source) DO UPDATE SET sample_at=excluded.sample_at,start_at=excluded.start_at,
 indoor_co2=excluded.indoor_co2,indoor_temperature=excluded.indoor_temperature,indoor_humidity=excluded.indoor_humidity,indoor_pm25=excluded.indoor_pm25,outdoor_temperature=excluded.outdoor_temperature,outdoor_humidity=excluded.outdoor_humidity,outdoor_pm25=excluded.outdoor_pm25,window_open=excluded.window_open,co2_limit=excluded.co2_limit,pm25_limit=excluded.pm25_limit,ventilation_on=excluded.ventilation_on;
 DELETE FROM history_bridge WHERE sample_at+interval '90 seconds'<=effective;
 DELETE FROM measurements WHERE timestamp<effective; GET DIAGNOSTICS deleted=ROW_COUNT;
 INSERT INTO history_watermark VALUES(TRUE,effective) ON CONFLICT(singleton) DO UPDATE SET cutoff=excluded.cutoff;
 DELETE FROM archived_air_stats WHERE bucket<date_trunc('hour',assessed-interval '90 days','UTC');
 TRUNCATE live_air_stats;
 INSERT INTO live_air_stats SELECT * FROM air_stats_rows(NULL,assessed);
 RETURN deleted;
END; $$;

CREATE OR REPLACE FUNCTION refresh_live_air_stats(assessed TIMESTAMPTZ DEFAULT clock_timestamp()) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('aircheck-history'));
 TRUNCATE live_air_stats;
 INSERT INTO live_air_stats SELECT * FROM air_stats_rows(NULL,assessed);
END; $$;

CREATE OR REPLACE FUNCTION reject_finalized_measurement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('aircheck-history'));
 IF NEW.timestamp<(SELECT cutoff FROM history_watermark WHERE singleton) THEN
   RAISE EXCEPTION 'history_finalized' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS measurement_history_watermark ON measurements;
CREATE TRIGGER measurement_history_watermark BEFORE INSERT ON measurements FOR EACH ROW EXECUTE FUNCTION reject_finalized_measurement();
