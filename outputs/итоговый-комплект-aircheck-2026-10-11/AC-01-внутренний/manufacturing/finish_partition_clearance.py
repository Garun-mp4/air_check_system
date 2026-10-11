"""Reproduce the two OCS partition trims on the cleaned mesh with OpenCascade.

The native OCS model has the same cuts and volume 310502.2548372121 mm3.
The original OCS raw export is retained as the reproducible input. This step
is necessary because the native export dialog could not be operated reliably.
"""
from pathlib import Path
import struct
from inspect_stl import read, inspect
from build_exchange_step import mesh_solid, box, volume
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.StlAPI import StlAPI_Writer
from OCP.BRepCheck import BRepCheck_Analyzer
import tempfile

root=Path(__file__).resolve().parent
rows=[];seen=set()
for row in read(root/'AC-01-001-base-raw-R01.stl'):
    a,b,c=[tuple(round(v,5) for v in row[i:i+3]) for i in (3,6,9)]
    ab=[b[i]-a[i] for i in range(3)];ac=[c[i]-a[i] for i in range(3)]
    cr=(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])
    key=tuple(sorted((a,b,c)))
    if sum(v*v for v in cr)<1e-14 or key in seen:continue
    seen.add(key);rows.append(row)
with tempfile.TemporaryDirectory(prefix='ac01-clearance-') as tmp:
    source=Path(tmp)/'source.stl'
    with source.open('wb') as f:
        f.write(b'Clean original OCS partition export; mm'.ljust(80,b' '));f.write(struct.pack('<I',len(rows)))
        for row in rows:f.write(struct.pack('<12fH',*row))
    shape=mesh_solid(source)
    for cutter in (box(6.5,137,4,1.1,4,62),box(57,182.4,4,4,1.6,62)):
        op=BRepAlgoAPI_Cut(shape,cutter);op.Build();assert op.IsDone();shape=op.Shape()
    assert BRepCheck_Analyzer(shape).IsValid()
    assert abs(volume(shape)-310502.2548372121)<0.1
    BRepMesh_IncrementalMesh(shape,0.01,False,0.1,False).Perform()
    w=StlAPI_Writer();w.ASCIIMode=False
    assert w.Write(shape,str(root/'AC-01-001-base-print-R01.stl'))
print(inspect(root/'AC-01-001-base-print-R01.stl'))
