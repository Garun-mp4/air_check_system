"""Synthetic real-protocol producer for the isolated browser harness only; no hardware claim."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

def deliver(request):
    # A cold local server can finish ingestion after the client times out. Retry
    # the identical frame so the same boot/sequence exercises server deduplication.
    for attempt in range(3):
        try:
            with urlopen(request, timeout=10) as response:
                if response.status not in (200, 201): raise RuntimeError('Fixture rejected')
            return
        except HTTPError:
            raise
        except (TimeoutError, URLError):
            if attempt == 2: raise
            print('Fixture transport interrupted; retrying identical frame', flush=True)

def run(metadata, state_file):
    config=json.loads(metadata.read_text())
    if config.get('mode')!='real' or not config.get('test_scope') or urlparse(config['base_url']).hostname not in ('localhost','127.0.0.1'):
        raise ValueError('Only an isolated real-mode browser harness is supported')
    started=time.monotonic(); sequence=0; last_good={}
    channels={'indoor_climate':{'co2':900,'temperature':23,'humidity':45},'outdoor_climate':{'temperature':18,'humidity':50},'indoor_particles':{'pm25':8},'outdoor_particles':{'pm25':12}}
    while not metadata.with_suffix('.stop').exists():
        state=json.loads(state_file.read_text()) if state_file.exists() else {}
        if state.get('paused'):
            time.sleep(.25)
            continue
        now=datetime.now(timezone.utc); iso=now.isoformat().replace('+00:00','Z'); sensors=[]
        for identifier,values in channels.items():
            failed=state.get('failed_sensor')==identifier
            if not failed: last_good[identifier]=now
            last=last_good.get(identifier)
            sensors.append({'sensor_id':identifier,'status':'timeout' if failed else 'ok','reason':'acceptance fixture timeout' if failed else 'ok',
                'last_good_at':last.isoformat().replace('+00:00','Z') if last else None,'age_ms':round((now-last).total_seconds()*1000) if last else 0,
                'consecutive_failures':1 if failed else 0,'values':values if last else {key:None for key in values}})
        position=state.get('window_position',0)
        actuators={'window':{'open_limit':position==100,'close_limit':position==0,'position_percent':position,'position_quality':'measured' if position is not None else 'unknown','motion':state.get('motion','stopped')}}
        for target in ('intake','exhaust'):
            on=state.get(target,False); actuators[target]={'requested_on':on,'rpm':1200 if on else 0,'status':'measured'}
        body={'schema_version':2,'device_id':'room-01','data_source':'real','boot_id':'acceptance-'+config['test_scope'],'sequence':sequence,'sampled_at':iso,'sensors':sensors,
            'controller':{'uptime_ms':round((time.monotonic()-started)*1000),'reset_reason':None,'firmware_version':'synthetic-acceptance-fixture','free_heap':None,'minimum_free_heap':None,'clock_synced':True,'outputs_commissioned':True,'dropped_packets':0,'queue_depth':0},
            'actuators':actuators,'command_results':[{'id':identifier,'status':'applied'} for identifier in state.get('applied_ids',[])]}
        headers={'Content-Type':'application/json','Authorization':'Bearer '+config['device_token'],'X-AirCheck-Source':'real'}
        request=Request(config['base_url']+'/api/v1/telemetry',data=json.dumps(body).encode(),headers=headers,method='POST')
        deliver(request)
        sequence+=1
        time.sleep(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--metadata',type=Path,required=True); parser.add_argument('--state-file',type=Path,required=True)
    args=parser.parse_args(); run(args.metadata,args.state_file)
