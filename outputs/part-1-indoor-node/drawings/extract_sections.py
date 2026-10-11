"""Extract actual X/Z section contours from the independently checked meshes."""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'manufacturing'))
from build_exchange_step import mesh_solid
from OCP.BRepAlgoAPI import BRepAlgoAPI_Section
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pln,gp_Pnt,gp_Dir

def section(file,y):
    shape=mesh_solid(root/'manufacturing'/file)
    op=BRepAlgoAPI_Section(shape,gp_Pln(gp_Pnt(0,y,0),gp_Dir(0,1,0)),False)
    op.Build();assert op.IsDone()
    edges=[];it=TopExp_Explorer(op.Shape(),TopAbs_EDGE)
    while it.More():
        curve=BRepAdaptor_Curve(TopoDS.Edge(it.Current()))
        a=curve.Value(curve.FirstParameter());b=curve.Value(curve.LastParameter())
        p=[round(a.X(),5),round(a.Z(),5)];q=[round(b.X(),5),round(b.Z(),5)]
        if p!=q:edges.append([p,q])
        it.Next()
    assert edges
    return dict(source=file,plane_y_mm=y,segments=edges)

data={'A-A':section('AC-01-001-base-print-R01.stl',14),
      'B-B':section('AC-01-002-lid-assembly-position.stl',95)}
(root/'drawings/model-sections.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
print({key:len(value['segments']) for key,value in data.items()})
