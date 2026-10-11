"""Build independently checkable analytic STEP and print-oriented STL from cad/design.json.

Lengths are millimetres.  The OCS DWG remains the editable native source; this
script reproduces its explicit BOX/CYLINDER CSG recipe with OpenCascade and
checks each export by reopening it.
"""
from __future__ import annotations
import json, math, struct
from collections import Counter
from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.GProp import GProp_GProps
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'cad/design.json'
MODEL=ROOT/'cad/model'
PRINT=ROOT/'manufacturing'
MODEL.mkdir(parents=True,exist_ok=True)
design=json.loads(SOURCE.read_text(encoding='utf-8'))

def box(p):
    x,y,z=p['p']; dx,dy,dz=p['size']
    return BRepPrimAPI_MakeBox(gp_Pnt(x,y,z),dx,dy,dz).Shape()

def cylinder(p):
    x,y,z=p['p']
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,z),gp_Dir(0,0,1)),p['radius'],p['height']).Shape()

def primitive(p): return box(p) if p['kind']=='box' else cylinder(p)

def fuse(a,b,label):
    op=BRepAlgoAPI_Fuse(a,b); op.Build()
    if not op.IsDone(): raise RuntimeError(f'fuse failed: {label}')
    return op.Shape()

def cut(a,b,label):
    op=BRepAlgoAPI_Cut(a,b); op.Build()
    if not op.IsDone(): raise RuntimeError(f'cut failed: {label}')
    return op.Shape()

def solids(shape):
    it=TopExp_Explorer(shape,TopAbs_SOLID); out=[]
    while it.More(): out.append(TopoDS.Solid(it.Current())); it.Next()
    return out

def volume(shape):
    props=GProp_GProps(); BRepGProp.VolumeProperties_s(shape,props)
    return float(props.Mass())

def bounds(shape):
    box=Bnd_Box(); BRepBndLib.Add_s(shape,box)
    lo=[box.GetXMin(),box.GetYMin(),box.GetZMin()]
    hi=[box.GetXMax(),box.GetYMax(),box.GetZMax()]
    return dict(min=[round(v,5) for v in lo],max=[round(v,5) for v in hi],
                extents=[round(hi[i]-lo[i],5) for i in range(3)])

def read_reference_step(path):
    reader=STEPControl_Reader(); status=reader.ReadFile(str(path)); roots=reader.TransferRoots()
    shape=reader.OneShape()
    if str(status) not in ('IFSelect_ReturnStatus.IFSelect_RetDone','RetDone') or not roots or shape.IsNull():
        raise RuntimeError(f'Cannot read manufacturer STEP: {path}')
    if not BRepCheck_Analyzer(shape).IsValid(): raise RuntimeError(f'Invalid manufacturer STEP: {path}')
    return shape

def relocate_to_bounds(shape,x,y,z):
    b=bounds(shape); tr=gp_Trsf()
    tr.SetTranslation(gp_Vec(x-b['min'][0],y-b['min'][1],z-b['min'][2]))
    result=BRepBuilderAPI_Transform(shape,tr,True).Shape()
    return result,b

def build(definition,label):
    shell=definition['shell']
    if not shell: raise RuntimeError(f'{label}: no shell')
    result=primitive(shell[0])
    for i,v in enumerate(shell[1:],1): result=cut(result,primitive(v),f'{label}:shell cavity {i}')
    for i,v in enumerate(definition.get('add',[])): result=fuse(result,primitive(v),f'{label}:add {i}')
    for i,v in enumerate(definition.get('cut',[])): result=cut(result,primitive(v),f'{label}:cut {i}')
    count=len(solids(result))
    if count!=1: raise RuntimeError(f'{label}: expected one connected solid, got {count}')
    if not BRepCheck_Analyzer(result).IsValid(): raise RuntimeError(f'{label}: invalid BRep')
    return result

def transform(shape,print_name):
    tr=gp_Trsf()
    if print_name=='identity':
        tr.SetTranslation(gp_Vec(0,0,0))
    elif print_name=='flip_lid':
        # Rigid 180-degree rotation around X; outer plate face sits on bed.
        tr.SetValues(1,0,0,0, 0,-1,0,180, 0,0,-1,63)
    elif print_name=='hood_front_down':
        # Outer roof Z=86 on bed; 90 mm body height.
        tr.SetValues(1,0,0,8, 0,1,0,0, 0,0,-1,86)
    elif print_name=='bracket_back_down':
        tr.SetTranslation(gp_Vec(0,-18,12))
    elif print_name=='screen_roof_down':
        tr.SetValues(1,0,0,-4.3, 0,-1,0,74, 0,0,-1,28.8)
    else: raise ValueError(f'Unknown print orientation {print_name}')
    return BRepBuilderAPI_Transform(shape,tr,True).Shape()

def compound(shapes):
    result=TopoDS_Compound(); builder=BRep_Builder(); builder.MakeCompound(result)
    for sh in shapes: builder.Add(result,sh)
    return result

def export_step(path,shapes):
    src=compound(shapes); writer=STEPControl_Writer()
    writer.Transfer(src,STEPControl_AsIs)
    status=writer.Write(str(path))
    if str(status) not in ('IFSelect_ReturnStatus.IFSelect_RetDone','RetDone'):
        raise RuntimeError(f'STEP write failed: {path}: {status}')
    reader=STEPControl_Reader(); status=reader.ReadFile(str(path)); roots=reader.TransferRoots(); out=reader.OneShape()
    if not roots or out.IsNull() or not BRepCheck_Analyzer(out).IsValid(): raise RuntimeError(f'STEP reload invalid: {path}')
    return dict(file=path.name,valid=True,solids=len(solids(out)),volume_mm3=round(volume(out),5),format='STEP AP214, mm')

def export_stl(shape,path):
    mesher=BRepMesh_IncrementalMesh(shape,0.08,False,0.25,True); mesher.Perform()
    if not mesher.IsDone(): raise RuntimeError(f'mesh failed: {path}')
    writer=StlAPI_Writer(); writer.ASCIIMode=False
    if not writer.Write(shape,str(path)): raise RuntimeError(f'STL write failed: {path}')
    return inspect_stl(path)

def inspect_stl(path):
    data=path.read_bytes()
    if len(data)<84: raise RuntimeError(f'STL truncated: {path}')
    n=struct.unpack_from('<I',data,80)[0]
    if len(data)!=84+n*50: raise RuntimeError(f'STL byte count mismatch: {path}')
    edges=Counter(); pts=[]; signed=0.0; degenerate=0
    for k in range(n):
        vals=struct.unpack_from('<12fH',data,84+k*50)
        a,b,c=[tuple(round(x,5) for x in vals[i:i+3]) for i in (3,6,9)]
        pts.extend((a,b,c))
        for u,v in ((a,b),(b,c),(c,a)): edges[tuple(sorted((u,v)))]+=1
        cross=(b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0])
        signed+=sum(a[i]*cross[i] for i in range(3))/6
        ab=[b[i]-a[i] for i in range(3)]; ac=[c[i]-a[i] for i in range(3)]
        area=(ab[1]*ac[2]-ab[2]*ac[1])**2+(ab[2]*ac[0]-ab[0]*ac[2])**2+(ab[0]*ac[1]-ab[1]*ac[0])**2
        degenerate+=area<1e-14
    boundary=sum(v==1 for v in edges.values()); nonmanifold=sum(v>2 for v in edges.values())
    if not pts or boundary or nonmanifold or degenerate: raise RuntimeError(f'non-watertight STL {path.name}: boundary={boundary} nonmanifold={nonmanifold} degenerate={degenerate}')
    lo=[min(v[i] for v in pts) for i in range(3)]; hi=[max(v[i] for v in pts) for i in range(3)]
    return dict(file=path.name,triangles=n,bounds_min=[round(v,4) for v in lo],bounds_max=[round(v,4) for v in hi],
        extents_mm=[round(hi[i]-lo[i],4) for i in range(3)],signed_volume_mm3=round(signed,4),
        boundary_edges=boundary,nonmanifold_edges=nonmanifold,degenerate_triangles=degenerate,units='mm (STL has no embedded units)')

body={}; parts=[]; stl_results=[]; step_results=[]
for designation,definition in design['parts'].items():
    shape=build(definition,designation); body[designation]=shape; parts.append(shape)
    oriented=transform(shape,definition['print_transform'])
    slug=designation.lower()
    stl_results.append(export_stl(oriented,PRINT/f'{designation}-print-R01.stl'))
    step_results.append(export_step(MODEL/f'{designation}-print-R01.step',[oriented]))
    step_results.append(export_step(MODEL/f'{designation}-assembly-R01.step',[shape]))
    print(json.dumps(dict(part=designation,solid_count=len(solids(shape)),volume_mm3=round(volume(shape),3),print_extents=stl_results[-1]['extents_mm']),ensure_ascii=False),flush=True)

# Manufacturer STEP references are placed from measured source bounds. The SPS30
# model is rotated so its two inlets/outlet face Y=0; its JST connector faces +Y.
sps_source=read_reference_step(ROOT/'cad/reference/sensirion_sps30_official.step')
sps_transform=gp_Trsf()
sps_box=bounds(sps_source)
# Local STEP X- is the air-port face. Map local X->world +Y, Z->world +X,
# and thin local Y->world +Z, then translate the source bounds onto the support.
sps_transform.SetValues(0,0,1,90-sps_box['min'][2],
                        1,0,0,4.5-sps_box['min'][0],
                        0,1,0,22-sps_box['min'][1])
sps_ref=BRepBuilderAPI_Transform(sps_source,sps_transform,True).Shape()

sht_source=read_reference_step(ROOT/'cad/reference/adafruit_sht45_5665.step')
sht_ref,sht_source_bounds=relocate_to_bounds(sht_source,14,28,18)

refs=[]
reference_bounds={}
for key,definition in design['refs'].items():
    if key=='REF-SPS30':
        refs.append(sps_ref); reference_bounds[key]=bounds(sps_ref)
    elif key=='REF-SHT45':
        refs.append(sht_ref); reference_bounds[key]=bounds(sht_ref)
    else:
        shape=build(definition,key); refs.append(shape); reference_bounds[key]=bounds(shape)
refs.extend(primitive(v) for v in design['ref_extra'])
assembly=parts+refs
assembly_path=MODEL/'AC-02-000-assembly-R01.step'
step_results.append(export_step(assembly_path,assembly))

checks=[]
for i,a in enumerate(parts):
    for j,b in enumerate(parts[i+1:],i+1):
        op=BRepAlgoAPI_Common(a,b); op.Build(); inter=volume(op.Shape()) if op.IsDone() else float('nan')
        checks.append(dict(a=list(design['parts'])[i],b=list(design['parts'])[j],intersection_mm3=round(inter,5)))
        if math.isnan(inter) or inter>0.05: raise RuntimeError(f'printed parts collide: {checks[-1]}')
# Intentional fit checks: electronic envelopes are clear of separate housing bodies.
electronics=[]
for i,part in enumerate(parts):
    for key,ref in zip(design['refs'],refs[:3]):
        op=BRepAlgoAPI_Common(part,ref); op.Build(); inter=volume(op.Shape()) if op.IsDone() else float('nan')
        electronics.append(dict(part=list(design['parts'])[i],reference=key,intersection_mm3=round(inter,5)))
        if math.isnan(inter) or inter>0.05: raise RuntimeError(f'body intersects electronics reference: {electronics[-1]}')

result=dict(revision='R01',units='mm',source='cad/design.json',part_count=len(body),parts={k:round(volume(v),4) for k,v in body.items()},
    stl=stl_results,step=step_results,printed_part_intersections=checks,electronics_intersections=electronics,
    electronic_references=reference_bounds,
    reference_note='The SPS30 and Adafruit SHT45 #5665 are exact manufacturer STEP bodies in the exchange assembly. ESP32-DevKitC V4 uses an LOD0 dimensional envelope; manufacturer dimension sources are retained in cad/reference. Electronic reference geometry is not printable.')
(ROOT/'manufacturing/model-inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(status='PASS',printed_parts=len(body),step_files=len(step_results),assembly_solids=len(solids(compound(assembly))),stl_meshes=len(stl_results),printed_interferences=sum(v['intersection_mm3']>0.05 for v in checks),housing_to_electronics_interferences=sum(v['intersection_mm3']>0.05 for v in electronics)),ensure_ascii=False),flush=True)
