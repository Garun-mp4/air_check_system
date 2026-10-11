"""Independent OpenCascade STEP read and topology check. Requires cadquery-ocp."""
import json
from pathlib import Path
from OCP.STEPControl import STEPControl_Reader
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

root=Path(__file__).resolve().parents[1]
results=[]
for p in sorted((root/'cad/model').glob('*.step')):
    r=STEPControl_Reader(); status=r.ReadFile(str(p)); roots=r.TransferRoots(); shape=r.OneShape()
    counts={}
    for name,typ in [('solids',TopAbs_SOLID),('faces',TopAbs_FACE)]:
        it=TopExp_Explorer(shape,typ); n=0
        while it.More(): n+=1; it.Next()
        counts[name]=n
    props=GProp_GProps(); BRepGProp.VolumeProperties_s(shape,props)
    result=dict(file=p.name,read_status=str(status),transferred_roots=roots,valid=BRepCheck_Analyzer(shape).IsValid(),volume_mm3=props.Mass(),**counts)
    assert roots and not shape.IsNull() and result['valid'] and counts['solids'],p
    results.append(result);print(json.dumps(result),flush=True)
(root/'manufacturing/step-inspection.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
