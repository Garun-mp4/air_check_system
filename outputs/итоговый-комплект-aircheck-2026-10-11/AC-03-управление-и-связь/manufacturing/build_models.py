"""Build AC-03 STEP and print STL from the explicit millimetre design data.

The native OpenCAD Studio DWG is the editable CAD deliverable. This standalone
OpenCascade script independently reconstructs the CSG dimensions recorded in
design.json, exports exchange and print meshes, reopens each STEP, checks
watertight STL topology, and rejects geometric interference above tolerance.
"""
from __future__ import annotations

import json
import math
import os
import re
import struct
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

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "cad" / "design.json"
MODEL = ROOT / "cad" / "model"
PRINT = ROOT / "manufacturing"
MODEL.mkdir(parents=True, exist_ok=True)
design = json.loads(DESIGN.read_text(encoding="utf-8"))
REVISION = os.environ.get("AIRCHECK_MODEL_REVISION", "R01")
if not re.fullmatch(r"R\d{2}", REVISION):
    raise ValueError(f"Invalid AIRCHECK_MODEL_REVISION: {REVISION!r}")
TOL = 0.02


def box(p: dict) -> object:
    x, y, z = p["p"]
    dx, dy, dz = p["size"]
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def cylinder(p: dict) -> object:
    x, y = p["center"]
    return BRepPrimAPI_MakeCylinder(
        gp_Ax2(gp_Pnt(x, y, p["z"]), gp_Dir(0, 0, 1)),
        p["radius"],
        p["height"],
    ).Shape()


def bounds(shape: object) -> dict:
    b = Bnd_Box()
    BRepBndLib.Add_s(shape, b)
    low = [b.GetXMin(), b.GetYMin(), b.GetZMin()]
    high = [b.GetXMax(), b.GetYMax(), b.GetZMax()]
    return {
        "min": [round(v, 5) for v in low],
        "max": [round(v, 5) for v in high],
        "extents": [round(high[i] - low[i], 5) for i in range(3)],
    }


def solids(shape: object) -> list:
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    result = []
    while explorer.More():
        result.append(TopoDS.Solid(explorer.Current()))
        explorer.Next()
    return result


def volume(shape: object) -> float:
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return float(props.Mass())


def valid(shape: object, label: str) -> None:
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():
        raise RuntimeError(f"{label}: null or invalid B-rep")
    if len(solids(shape)) != 1:
        raise RuntimeError(f"{label}: expected one connected solid, got {len(solids(shape))}")


def fuse(a: object, b: object, label: str) -> object:
    operation = BRepAlgoAPI_Fuse(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError(f"{label}: fuse failed")
    return operation.Shape()


def cut(a: object, b: object, label: str) -> object:
    operation = BRepAlgoAPI_Cut(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError(f"{label}: cut failed")
    return operation.Shape()


def make_part(key: str, definition: dict) -> object:
    result = box(definition["outer"])
    result = cut(result, box(definition["cavity"]), f"{key}: cavity")
    if key.endswith("base"):
        for i, feature in enumerate(definition["bosses"], 1):
            result = fuse(result, box(feature), f"{key}: boss {i}")
        for feature in definition["apertures"]:
            result = cut(result, box(feature), f"{key}: {feature['name']}")
        for i, feature in enumerate(definition["pilot_holes"], 1):
            result = cut(result, cylinder(feature), f"{key}: pilot {i}")
    else:
        for i, feature in enumerate(definition["clearance_holes"], 1):
            result = cut(result, cylinder(feature), f"{key}: clearance hole {i}")
    valid(result, key)
    measured = bounds(result)
    if measured["min"] != definition["expected_bounds"]["min"] or measured["max"] != definition["expected_bounds"]["max"]:
        raise RuntimeError(f"{key}: bounds differ from native CAD observation: {measured}")
    return result


def make_reference(definition: dict) -> object:
    return box({"p": definition["p"], "size": definition["size"]})


def intersection_volume(a: object, b: object, label: str) -> float:
    operation = BRepAlgoAPI_Common(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError(f"{label}: common/interference kernel failed")
    return max(0.0, volume(operation.Shape()))


def compound(shapes: list) -> object:
    result = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(result)
    for shape in shapes:
        builder.Add(result, shape)
    return result


def export_step(path: Path, shapes: list, expected_solids: int) -> dict:
    writer = STEPControl_Writer()
    writer.Transfer(compound(shapes), STEPControl_AsIs)
    status = writer.Write(str(path))
    if str(status) not in ("IFSelect_ReturnStatus.IFSelect_RetDone", "RetDone"):
        raise RuntimeError(f"STEP write failed: {path}: {status}")
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    roots = reader.TransferRoots()
    reopened = reader.OneShape()
    count = len(solids(reopened))
    if not roots or reopened.IsNull() or not BRepCheck_Analyzer(reopened).IsValid() or count != expected_solids:
        raise RuntimeError(f"STEP reload failed: {path}; roots={roots}; solids={count}")
    return {
        "file": path.name,
        "valid": True,
        "solids": count,
        "volume_mm3": round(volume(reopened), 4),
        "bounds": bounds(reopened),
        "format": "STEP, millimetres",
    }


def print_transform(shape: object, orientation: str) -> object:
    tr = gp_Trsf()
    if orientation == "identity":
        tr.SetTranslation(gp_Vec(0, 0, 0))
    elif orientation == "top_face_on_bed":
        # Rotate the outside cover face to Z=0; the skirt opens upward.
        tr.SetValues(1, 0, 0, 0, 0, -1, 0, 110, 0, 0, -1, 58)
    else:
        raise ValueError(f"Unknown print transform: {orientation}")
    return BRepBuilderAPI_Transform(shape, tr, True).Shape()


def export_stl(shape: object, path: Path) -> dict:
    mesher = BRepMesh_IncrementalMesh(shape, 0.08, False, 0.22, True)
    mesher.Perform()
    if not mesher.IsDone():
        raise RuntimeError(f"STL mesh generation failed: {path}")
    writer = StlAPI_Writer()
    writer.ASCIIMode = False
    if not writer.Write(shape, str(path)):
        raise RuntimeError(f"STL write failed: {path}")
    return inspect_stl(path)


def inspect_stl(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 84:
        raise RuntimeError(f"Truncated STL: {path}")
    triangles = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + triangles * 50:
        raise RuntimeError(f"STL size/count mismatch: {path}")
    edge_use = Counter()
    vertices = []
    signed_volume = 0.0
    degenerate = 0
    for i in range(triangles):
        values = struct.unpack_from("<12fH", data, 84 + i * 50)
        a, b, c = [tuple(round(v, 5) for v in values[j:j + 3]) for j in (3, 6, 9)]
        vertices.extend((a, b, c))
        for u, v in ((a, b), (b, c), (c, a)):
            edge_use[tuple(sorted((u, v)))] += 1
        cross = (
            b[1] * c[2] - b[2] * c[1],
            b[2] * c[0] - b[0] * c[2],
            b[0] * c[1] - b[1] * c[0],
        )
        signed_volume += sum(a[k] * cross[k] for k in range(3)) / 6.0
        ab = [b[k] - a[k] for k in range(3)]
        ac = [c[k] - a[k] for k in range(3)]
        area2 = sum((ab[(k + 1) % 3] * ac[(k + 2) % 3] - ab[(k + 2) % 3] * ac[(k + 1) % 3]) ** 2 for k in range(3))
        degenerate += area2 < 1e-14
    boundary = sum(uses == 1 for uses in edge_use.values())
    nonmanifold = sum(uses > 2 for uses in edge_use.values())
    if not vertices or boundary or nonmanifold or degenerate:
        raise RuntimeError(
            f"STL is not a closed 2-manifold: {path.name}, "
            f"boundary={boundary}, nonmanifold={nonmanifold}, degenerate={degenerate}"
        )
    low = [min(v[k] for v in vertices) for k in range(3)]
    high = [max(v[k] for v in vertices) for k in range(3)]
    if not math.isfinite(signed_volume) or signed_volume <= 0:
        raise RuntimeError(f"STL orientation/volume is invalid: {path.name}: {signed_volume}")
    return {
        "file": path.name,
        "triangles": triangles,
        "bounds_min_mm": [round(v, 4) for v in low],
        "bounds_max_mm": [round(v, 4) for v in high],
        "extents_mm": [round(high[k] - low[k], 4) for k in range(3)],
        "signed_volume_mm3": round(signed_volume, 4),
        "boundary_edges": boundary,
        "nonmanifold_edges": nonmanifold,
        "degenerate_triangles": degenerate,
        "units": "mm by project convention; STL does not embed units",
    }


parts = {key: make_part(key, spec) for key, spec in design["parts"].items()}
references = {key: make_reference(spec) for key, spec in design["references"].items()}

# Cross-check independently reconstructed B-reps against volumes measured
# directly from the active OpenCAD Studio solids. A 1 mm^3 limit covers CAD
# kernel boolean tolerances while catching a changed aperture or pilot detail.
native_measurements = design["native_cad_observation"]["measurements"]
volume_checks = {}
for key, shape in parts.items():
    cad_volume = native_measurements[key]["volume_mm3"]
    rebuilt_volume = volume(shape)
    difference = abs(cad_volume - rebuilt_volume)
    volume_checks[key] = {
        "cad_volume_mm3": round(cad_volume, 6),
        "rebuilt_volume_mm3": round(rebuilt_volume, 6),
        "absolute_difference_mm3": round(difference, 6),
    }
    if difference > 1.0:
        raise RuntimeError(f"{key}: STEP/STL source differs from OCS CAD volume: {volume_checks[key]}")

# Printed parts and every distinct fitted reference are checked pairwise.
intersections = []
all_shapes = list(parts.items()) + list(references.items())
for i, (key_a, shape_a) in enumerate(all_shapes):
    for key_b, shape_b in all_shapes[i + 1:]:
        amount = intersection_volume(shape_a, shape_b, f"{key_a}/{key_b}")
        intersections.append({"a": key_a, "b": key_b, "intersection_mm3": round(amount, 5)})
        if amount > TOL:
            raise RuntimeError(f"Unintended volume interference: {intersections[-1]}")

base_spec = design["parts"]["AC-03-001-base"]
lid_spec = design["parts"]["AC-03-002-lid"]
base_outer = base_spec["outer"]
base_cavity = base_spec["cavity"]
lid_cavity = lid_spec["cavity"]
base_top_z = base_outer["p"][2] + base_outer["size"][2]
base_wall_start_z = base_cavity["p"][2]
lid_cavity_start_z = lid_cavity["p"][2]
lid_cavity_end_z = lid_cavity_start_z + lid_cavity["size"][2]
xy_clearances = [
    (lid_cavity["size"][axis] - base_outer["size"][axis]) / 2
    for axis in (0, 1)
]
side_wall_engagement = max(
    0.0,
    min(base_top_z, lid_cavity_end_z) - max(base_wall_start_z, lid_cavity_start_z),
)
axial_clearance = lid_cavity_end_z - base_top_z
lid_fit = {
    "per_side_clearance_mm": round(min(xy_clearances), 3),
    "side_wall_engagement_mm": round(side_wall_engagement, 3),
    "axial_clearance_over_base_wall_mm": round(axial_clearance, 3),
    "base_outer_mm": list(base_outer["size"][:2]),
    "lid_inside_mm": list(lid_cavity["size"][:2]),
    "physical_fit_confirmed": design["lid_interface"]["physical_fit_confirmed"],
}
expected_fit = design["lid_interface"]
if abs(xy_clearances[0] - xy_clearances[1]) > TOL:
    raise RuntimeError("The lid has unequal X/Y side clearances")
if any(clearance < 0 for clearance in xy_clearances) or axial_clearance < 0:
    raise RuntimeError("The nominal lid geometry interferes with the base")
if abs(lid_fit["per_side_clearance_mm"] - expected_fit["nominal_xy_clearance_per_side_mm"]) > TOL:
    raise RuntimeError("The nominal lid clearance differs from design.json")
if abs(lid_fit["side_wall_engagement_mm"] - expected_fit["side_wall_engagement_mm"]) > TOL:
    raise RuntimeError("The side-wall engagement differs from design.json")
if abs(lid_fit["axial_clearance_over_base_wall_mm"] - expected_fit["axial_clearance_over_base_wall_mm"]) > TOL:
    raise RuntimeError("The axial clearance differs from design.json")

step_results = []
stl_results = []
ordered = list(parts.items())
for key, shape in ordered:
    slug = key.lower()
    step_results.append(export_step(MODEL / f"{key}-print-{REVISION}.step", [shape], 1))
    oriented = print_transform(shape, design["parts"][key]["print_transform"])
    stl_results.append(export_stl(oriented, PRINT / f"{key}-print-{REVISION}.stl"))

assembly_shapes = list(parts.values()) + list(references.values())
step_results.insert(
    0,
    export_step(MODEL / f"AC-03-000-assembly-{REVISION}.step", assembly_shapes, design["assembly"]["expected_solids"]),
)

result = {
    "revision": REVISION,
    "drawing_reference": f"AC-03 drawing {REVISION}",
    "geometry_baseline": "R01 dimensions in cad/design.json; current drawing release carries the same nominal part geometry",
    "source": "cad/design.json",
    "units": "mm",
    "status": "PASS",
    "native_cad": f"cad/model/AC-03-000-assembly-{REVISION}.dwg; separately audited and save-verified in documentation/native-3d-verification-{REVISION}.json",
    "print_parts": {
        key: {"bounds": bounds(shape), "volume_mm3": round(volume(shape), 4), "solids": len(solids(shape))}
        for key, shape in parts.items()
    },
    "references": {
        key: {"bounds": bounds(shape), "volume_mm3": round(volume(shape), 4), "fidelity": design["references"][key]["fidelity"]}
        for key, shape in references.items()
    },
    "nominal_lid_fit": lid_fit,
    "native_cad_volume_checks": volume_checks,
    "pairwise_interference_checks": intersections,
    "step": step_results,
    "stl": stl_results,
    "limits": design["print_process"]["limits"],
}
out = PRINT / ("model-inspection-R01.json" if REVISION == "R01" else f"model-inspection-{REVISION}.json")
out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "status": "PASS",
    "printed_parts": len(parts),
    "assembly_solids": len(assembly_shapes),
    "step_files": len(step_results),
    "stl_files": len(stl_results),
    "largest_intersection_mm3": max(v["intersection_mm3"] for v in intersections),
    "inspection": out.name,
}, ensure_ascii=False))
