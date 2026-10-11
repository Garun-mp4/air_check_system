"""Build and independently reopen faceted STEP from cleaned OCS STL.

Requires cadquery-ocp. DWG is the authoritative editable CAD source. This
conversion preserves mesh geometry; it does not reconstruct analytic cylinders.
"""
import json
from pathlib import Path
from OCP.TopoDS import TopoDS, TopoDS_Shape, TopoDS_Compound
from OCP.StlAPI import StlAPI_Reader
from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
from OCP.BRep import BRep_Builder
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.STEPControl import STEPControl_Writer, STEPControl_Reader, STEPControl_AsIs
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer

root=Path(__file__).resolve().parents[1]
model=root/'cad/model'
def mesh_solid(file):
    shape=TopoDS_Shape(); assert StlAPI_Reader().Read(shape,str(file))
    sew=BRepBuilderAPI_Sewing(1e-5);sew.Add(shape);sew.Perform()
    shell=TopoDS.Shell(sew.SewedShape())
    assert shell.Closed(), 'STL did not sew to closed shell'
    solid=BRepBuilderAPI_MakeSolid(shell).Solid()
    assert BRepCheck_Analyzer(solid).IsValid(), 'Invalid sewn solid'
    return solid
def box(x,y,z,dx,dy,dz):return BRepPrimAPI_MakeBox(gp_Pnt(x,y,z),dx,dy,dz).Shape()
def compound(shapes):
    c=TopoDS_Compound();b=BRep_Builder();b.MakeCompound(c)
    for s in shapes:b.Add(c,s)
    return c
def volume(s):
    p=GProp_GProps();BRepGProp.VolumeProperties_s(s,p);return p.Mass()
def export(name,shapes):
    shape=compound(shapes);p=model/name
    w=STEPControl_Writer();w.Transfer(shape,STEPControl_AsIs);w.Write(str(p))
    r=STEPControl_Reader();r.ReadFile(str(p));roots=r.TransferRoots();s=r.OneShape()
    assert roots and not s.IsNull() and BRepCheck_Analyzer(s).IsValid(),name
    it=TopExp_Explorer(s,TopAbs_SOLID);n=0
    while it.More():n+=1;it.Next()
    result=dict(file=name,valid=True,solids=n,volume_mm3=volume(s),source='OCS cleaned STL for housing; documented LOD0 envelopes for purchased parts',representation='faceted planar BREP housing, mm')
    print(json.dumps(result),flush=True);return result

if __name__=='__main__':
    base=mesh_solid(root/'manufacturing/AC-01-001-base-print-R01.stl')
    lid=mesh_solid(root/'manufacturing/AC-01-002-lid-assembly-position.stl')
    assert abs(volume(base)-310502.2548372121)<0.1
    assert abs(volume(lid)-92044.02449834802)<0.1
    sps=[box(54.4,4.5,22,41.2,41.2,12.3)]
    pcb=box(25,146,28,25.4,22.86,1.6)
    for x in (27.54,47.86):
        for y in (148.54,166.32):
            cut=BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,27),gp_Dir(0,0,1)),1.5,4).Shape()
            pcb=BRepAlgoAPI_Cut(pcb,cut).Shape()
    scd=[pcb,box(32.7,153.192,29.6,10,10,7.4)]
    esp=[box(90,115,16,48.26,27.94,1.6),box(92,120,17.6,25.5,18,3.2),box(138.26,124.5,16,10,9,6)]
    esp.extend(box(91.27,y,z,45.73,2.54,h) for y in (119.73,135.67) for z,h in ((10,6),(17.6,2.5)))
    results=[export('AC-01-001-base-exchange.step',[base]),export('AC-01-002-lid-exchange.step',[lid]),
             export('REF-SPS30-envelope.step',sps),export('REF-SCD41-5190-envelope.step',scd),
             export('REF-ESP32-V4-envelope.step',esp),export('AC-01-000-assembly-exchange.step',[base,lid,*sps,*scd,*esp])]
    (root/'manufacturing/step-inspection.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
