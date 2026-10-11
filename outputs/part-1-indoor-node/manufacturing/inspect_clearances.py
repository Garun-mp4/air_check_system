"""Independent gross-interference check, including intentional snap contacts."""
import json
from pathlib import Path
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt
root=Path(__file__).resolve().parents[1]
r=STEPControl_Reader();r.ReadFile(str(root/'cad/model/AC-01-001-base-exchange.step'));r.TransferRoots();base=r.OneShape()
rows=[]
for name,p,sz in [('SPS30',(54.4,4.5,22),(41.2,41.2,12.3)),('SCD41 PCB',(25,146,28),(25.4,22.86,1.6)),('SCD41 body',(32.7,153.192,29.6),(10,10,7.4)),('ESP32 PCB',(90,115,16),(48.26,27.94,1.6)),('USB keepout',(138.26,124.5,16),(10,9,6))]:
    shape=BRepPrimAPI_MakeBox(gp_Pnt(*p),*sz).Shape();op=BRepAlgoAPI_Common(base,shape);op.Build();assert op.IsDone()
    prop=GProp_GProps();BRepGProp.VolumeProperties_s(op.Shape(),prop)
    rows.append(dict(component=name,interference_mm3=prop.Mass()));print(rows[-1],flush=True)
(root/'manufacturing/clearance-inspection.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
lr=STEPControl_Reader();lr.ReadFile(str(root/'cad/model/AC-01-002-lid-exchange.step'));lr.TransferRoots()
op=BRepAlgoAPI_Common(base,lr.OneShape());op.Build();assert op.IsDone()
prop=GProp_GProps();BRepGProp.VolumeProperties_s(op.Shape(),prop)
rows.append(dict(component='Lid against base including SCD41 partition',interference_mm3=prop.Mass()))
(root/'manufacturing/clearance-inspection.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
print(rows[-1],flush=True)
assert abs(prop.Mass())<0.01, 'Lid and base interfere'
