import json
import pytest

@pytest.fixture
def notification_db(postgres_db):
    postgres_db.psql('TRUNCATE notification_reads,notification_events,notification_conditions,notification_settings;')
    yield postgres_db
    postgres_db.psql('TRUNCATE notification_reads,notification_events,notification_conditions,notification_settings;')

def test_notification_event_key_and_delivery_boundaries(notification_db):
    notification_db.psql("""INSERT INTO notification_events(event_key,device_id,kind,message) VALUES('episode','room-01','co2_high','CO2');
      INSERT INTO notification_events(event_key,device_id,kind,message) VALUES('episode','room-01','co2_high','duplicate') ON CONFLICT(event_key) DO NOTHING;""")
    assert notification_db.psql('SELECT count(*) FROM notification_events;').stdout.strip()=='1'
    for sql in ["UPDATE notification_events SET attempts=4;","UPDATE notification_events SET delivery_status='retry_forever';","INSERT INTO notification_settings(co2_duration_seconds) VALUES(0);"]:
        assert notification_db.psql(sql,check=False).returncode!=0

def test_read_marks_belong_to_each_account_and_cascade(notification_db):
    notification_db.psql('''INSERT INTO "user"(id,name,email) VALUES('notification-u1','One','notification-one@test'),('notification-u2','Two','notification-two@test');
      INSERT INTO notification_events(event_key,device_id,kind,message) VALUES('read','room-01','recovery','Recovered');
      INSERT INTO notification_reads(event_id,user_id) SELECT id,'notification-u1' FROM notification_events;
    ''')
    result=notification_db.psql("SELECT e.id,r.user_id FROM notification_events e LEFT JOIN notification_reads r ON r.event_id=e.id AND r.user_id='notification-u2';")
    assert result.stdout.strip().endswith('|')
    notification_db.psql('DELETE FROM notification_events;')
    assert notification_db.psql('SELECT count(*) FROM notification_reads;').stdout.strip()=='0'
    notification_db.psql('DELETE FROM "user" WHERE id IN (\'notification-u1\',\'notification-u2\');')
