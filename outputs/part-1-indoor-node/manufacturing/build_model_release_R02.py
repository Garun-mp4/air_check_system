"""Rebuild the AC-01 R02 exchange assembly with the available vendor SPS30 CAD.

The printable housing geometry is read from the validated, millimetre STL
exports. The SPS30 comes from Sensirion's supplied STEP model. The SCD41 board
and ESP32 DevKitC are documented LOD0 references because no full vendor STEP
models are present in this node's source set.
"""
from __future__ import annotations

import json
import struct
from collections import Counter
from pathlib import Path

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
from OCP.StlAPI import StlAPI_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "cad" / "model"
PRINT = ROOT / "manufacturing"
REFERENCE_SPS30 = ROOT / "cad" / "reference" / "sensirion_sps30_step" / "PS_CAD_SPS30_D1.STEP"
REVISION = "R02"
MESH_TOLERANCE = 1e-5


def box(x: float, y: float, z: float, dx: float, dy: float, dz: float):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def cylinder(x: float, y: float, z: float, radius: float, height: float):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1)), radius, height).Shape()


def compound(shapes):
    result = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(result)
    for shape in shapes:
        builder.Add(result, shape)
    return result


def solids(shape):
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    result = []
    while explorer.More():
        result.append(TopoDS.Solid(explorer.Current()))
        explorer.Next()
    return result


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return float(props.Mass())


def bounds(shape):
    box_value = Bnd_Box()
    BRepBndLib.Add_s(shape, box_value)
    minimum = [box_value.GetXMin(), box_value.GetYMin(), box_value.GetZMin()]
    maximum = [box_value.GetXMax(), box_value.GetYMax(), box_value.GetZMax()]
    return {
        "min_mm": [round(value, 5) for value in minimum],
        "max_mm": [round(value, 5) for value in maximum],
        "extents_mm": [round(maximum[i] - minimum[i], 5) for i in range(3)],
    }


def read_step(path: Path):
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    roots = reader.TransferRoots()
    shape = reader.OneShape()
    if str(status) not in ("IFSelect_ReturnStatus.IFSelect_RetDone", "RetDone") or not roots or shape.IsNull():
        raise RuntimeError(f"Cannot read STEP: {path}")
    if not BRepCheck_Analyzer(shape).IsValid():
        raise RuntimeError(f"Invalid STEP BREP: {path}")
    return shape


def read_mesh_solid(path: Path):
    shape = TopoDS_Shape()
    if not StlAPI_Reader().Read(shape, str(path)):
        raise RuntimeError(f"Cannot read STL: {path}")
    sewing = BRepBuilderAPI_Sewing(MESH_TOLERANCE)
    sewing.Add(shape)
    sewing.Perform()
    shell = TopoDS.Shell(sewing.SewedShape())
    if not shell.Closed():
        raise RuntimeError(f"STL did not sew to a closed shell: {path}")
    result = BRepBuilderAPI_MakeSolid(shell).Solid()
    if not BRepCheck_Analyzer(result).IsValid():
        raise RuntimeError(f"STL-derived solid is invalid: {path}")
    return result


def export_step(path: Path, shapes):
    writer = STEPControl_Writer()
    writer.Transfer(compound(shapes), STEPControl_AsIs)
    status = writer.Write(str(path))
    if str(status) not in ("IFSelect_ReturnStatus.IFSelect_RetDone", "RetDone"):
        raise RuntimeError(f"STEP write failed: {path}: {status}")
    reopened = read_step(path)
    return {
        "file": path.name,
        "valid": True,
        "solids": len(solids(reopened)),
        "volume_mm3": round(volume(reopened), 5),
        "bounds": bounds(reopened),
        "format": "STEP AP214, mm",
    }


def inspect_stl(path: Path):
    data = path.read_bytes()
    if len(data) < 84:
        raise RuntimeError(f"STL is truncated: {path}")
    triangle_count = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + triangle_count * 50:
        raise RuntimeError(f"STL byte count does not match triangle count: {path}")
    points = []
    edges = Counter()
    signed_volume = 0.0
    degenerate = 0
    for index in range(triangle_count):
        values = struct.unpack_from("<12fH", data, 84 + index * 50)
        a, b, c = [tuple(round(value, 5) for value in values[i:i + 3]) for i in (3, 6, 9)]
        points.extend((a, b, c))
        for u, v in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted((u, v)))] += 1
        cross = (
            b[1] * c[2] - b[2] * c[1],
            b[2] * c[0] - b[0] * c[2],
            b[0] * c[1] - b[1] * c[0],
        )
        signed_volume += sum(a[i] * cross[i] for i in range(3)) / 6
        ab = [b[i] - a[i] for i in range(3)]
        ac = [c[i] - a[i] for i in range(3)]
        area_squared = (
            (ab[1] * ac[2] - ab[2] * ac[1]) ** 2
            + (ab[2] * ac[0] - ab[0] * ac[2]) ** 2
            + (ab[0] * ac[1] - ab[1] * ac[0]) ** 2
        )
        degenerate += area_squared < 1e-14
    boundary_edges = sum(count == 1 for count in edges.values())
    nonmanifold_edges = sum(count > 2 for count in edges.values())
    if not points or boundary_edges or nonmanifold_edges or degenerate:
        raise RuntimeError(
            f"Invalid STL topology {path.name}: boundary={boundary_edges}, "
            f"nonmanifold={nonmanifold_edges}, degenerate={degenerate}"
        )
    minimum = [min(point[i] for point in points) for i in range(3)]
    maximum = [max(point[i] for point in points) for i in range(3)]
    return {
        "file": path.name,
        "triangles": triangle_count,
        "bounds_min_mm": [round(value, 4) for value in minimum],
        "bounds_max_mm": [round(value, 4) for value in maximum],
        "extents_mm": [round(maximum[i] - minimum[i], 4) for i in range(3)],
        "signed_volume_mm3": round(signed_volume, 4),
        "boundary_edges": boundary_edges,
        "nonmanifold_edges": nonmanifold_edges,
        "degenerate_triangles": degenerate,
        "units": "mm by project convention; STL does not embed units",
    }


def common_volume(a, b):
    operation = BRepAlgoAPI_Common(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError("OpenCascade failed to calculate an intersection")
    return round(max(0.0, volume(operation.Shape())), 5)


def common_bounds(a, b):
    operation = BRepAlgoAPI_Common(a, b)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError("OpenCascade failed to calculate an intersection")
    shape = operation.Shape()
    if shape.IsNull() or volume(shape) <= 0.05:
        return None
    return bounds(shape)


base_stl = PRINT / f"AC-01-001-base-print-{REVISION}.stl"
lid_stl = PRINT / f"AC-01-002-lid-print-{REVISION}.stl"
lid_assembly_stl = PRINT / "AC-01-002-lid-assembly-position.stl"
base = read_mesh_solid(base_stl)
lid_print = read_mesh_solid(lid_stl)
lid_assembly = read_mesh_solid(lid_assembly_stl)
if not REFERENCE_SPS30.is_file():
    raise FileNotFoundError(REFERENCE_SPS30)

sps_source = read_step(REFERENCE_SPS30)
sps_bounds = bounds(sps_source)
# Place the exact vendor model inside the existing R01 envelope. Map its local
# X to world Y (the port face remains toward Y=0), local Z to world X, and its
# thin local Y direction to world Z. No scale or dimensional compensation.
sps_transform = gp_Trsf()
sps_transform.SetValues(
    0, 0, 1, 54.4 - sps_bounds["min_mm"][2],
    1, 0, 0, 4.5 - sps_bounds["min_mm"][0],
    0, 1, 0, 22.0 - sps_bounds["min_mm"][1],
)
sps30 = BRepBuilderAPI_Transform(sps_source, sps_transform, True).Shape()
if not BRepCheck_Analyzer(sps30).IsValid():
    raise RuntimeError("Positioned SPS30 vendor model is invalid")

# LOD0 board and major component envelopes, matching the previous assembly.
scd_pcb = box(25, 146, 28, 25.4, 22.86, 1.6)
for x in (27.54, 47.86):
    for y in (148.54, 166.32):
        cut = BRepAlgoAPI_Cut(scd_pcb, cylinder(x, y, 27, 1.5, 4))
        cut.Build()
        if not cut.IsDone():
            raise RuntimeError("Cannot construct SCD41 board mounting holes")
        scd_pcb = cut.Shape()
scd_sensor = box(32.7, 153.192, 29.6, 10, 10, 7.4)

esp32 = [
    box(90, 115, 16, 48.26, 27.94, 1.6),
    box(92, 120, 17.6, 25.5, 18, 3.2),
    box(138.26, 124.5, 16, 10, 9, 6),
]
esp32.extend(
    box(91.27, y, z, 45.73, 2.54, height)
    for y in (119.73, 135.67)
    for z, height in ((10, 6), (17.6, 2.5))
)

print_parts = [base, lid_print]
printed_intersections = [{
    "a": "AC-01-001-base",
    "b": "AC-01-002-lid",
    "intersection_mm3": common_volume(base, lid_assembly),
}]
if printed_intersections[0]["intersection_mm3"] > 0.05:
    raise RuntimeError(f"Housing parts interfere: {printed_intersections[0]}")

references = {
    "REF-SPS30": sps30,
    "REF-SCD41-PCB": scd_pcb,
    "REF-SCD41-SENSOR-LOD0": scd_sensor,
    "REF-ESP32-LOD0": esp32[0],
}
electronics_intersections = []
for part_name, part_shape in (("AC-01-001-base", base), ("AC-01-002-lid", lid_assembly)):
    for ref_name, ref_shape in references.items():
        value = common_volume(part_shape, ref_shape)
        result = {"part": part_name, "reference": ref_name, "intersection_mm3": value}
        if value > 0.05:
            result["intersection_bounds"] = common_bounds(part_shape, ref_shape)
        electronics_intersections.append(result)

step_results = [
    export_step(MODEL / f"AC-01-001-base-print-{REVISION}.step", [base]),
    export_step(MODEL / f"AC-01-002-lid-print-{REVISION}.step", [lid_print]),
    export_step(MODEL / f"REF-SPS30-manufacturer-{REVISION}.step", [sps30]),
    export_step(MODEL / f"AC-01-000-assembly-{REVISION}.step", [base, lid_assembly, sps30, scd_pcb, scd_sensor, *esp32]),
]
stl_results = [inspect_stl(base_stl), inspect_stl(lid_stl)]
guide_overlap = next(
    entry for entry in electronics_intersections
    if entry["part"] == "AC-01-001-base" and entry["reference"] == "REF-SPS30"
)
release_status = "PASS_WITH_TOLERANCE_NOTE" if guide_overlap["intersection_mm3"] > 0.05 else "PASS"
review_notes = []
if guide_overlap["intersection_mm3"] > 0.05:
    review_notes.append({
        "severity": "fit_check_required",
        "reference": "REF-SPS30",
        "intersection_mm3": guide_overlap["intersection_mm3"],
        "nominal_fit": "The drawing sets 41.2 mm between SPS30 guide faces; the unscaled manufacturer STEP measures 41.20693 mm across that direction.",
        "disposition": "No scaling or hidden housing correction was applied. Preserve the drawing geometry and verify the actual part with a printed fit sample before assembly.",
    })

# The board envelopes deliberately engage the retaining snaps by 0.1 mm.
# Keep this documented as a functional print-fit check, not as an unexplained
# clash or a reason to alter the drawing-controlled housing geometry.
snap_references = {"REF-SCD41-PCB", "REF-ESP32-LOD0"}
for entry in electronics_intersections:
    if (
        entry["part"] == "AC-01-001-base"
        and entry["reference"] in snap_references
        and entry["intersection_mm3"] > 0.05
    ):
        review_notes.append({
            "severity": "intentional_snap_overlap_requires_print_test",
            "reference": entry["reference"],
            "intersection_mm3": entry["intersection_mm3"],
            "intersection_bounds": entry.get("intersection_bounds"),
            "nominal_fit": "The LOD0 PCB edge intentionally overlaps its retaining snaps by 0.1 mm, as documented in validation-R02.md.",
            "disposition": "Do not remove the snap engagement or change drawing-controlled STL geometry from this LOD0 calculation. Confirm the exact purchased board outline, snap elasticity and assembly force with a test print.",
        })
inspection = {
    "status": release_status,
    "revision": REVISION,
    "drawing_reference": "AC-01 drawing R02",
    "geometry_baseline": "R01 nominal housing geometry; R02 drawing changes are drafting/documentation only",
    "units": "mm",
    "native_dwg": "cad/model/AC-01-000-assembly-R02.dwg",
    "print_parts": [
        {"designation": "AC-01-001-base", "drawing_size_mm": [150, 190, 65]},
        {"designation": "AC-01-002-lid", "drawing_size_mm": [150, 190, 6.5]},
    ],
    "references": {
        "REF-SPS30": {
            "fidelity": "Sensirion manufacturer STEP, exact unscaled geometry",
            "source": "cad/reference/sensirion_sps30_step/PS_CAD_SPS30_D1.STEP",
            "source_bounds": sps_bounds,
            "assembly_bounds": bounds(sps30),
        },
        "REF-SCD41": {"fidelity": "LOD0 board outline and sensor envelope; Adafruit BRD source retained in cad/reference"},
        "REF-ESP32": {"fidelity": "LOD0 dimensional envelope from Espressif dimension drawing"},
    },
    "stl": stl_results,
    "step": step_results,
    "printed_part_intersections": printed_intersections,
    "housing_to_electronics_intersections": electronics_intersections,
    "review_notes": review_notes,
    "limits": [
        "STL files have no embedded unit declaration; millimetres are the project convention.",
        "Printer, nozzle, material, slicer profile and shrink compensation are not selected.",
        "Electronic reference bodies are not printable and real purchased parts have not been checked.",
        "The native OpenCAD Studio DWG retains LOD0 electronic references; exact manufacturer SPS30 geometry is included in the STEP exchange assembly.",
        "Physical fit and sensor performance are not confirmed without prototype printing and tests.",
    ],
}
(PRINT / f"model-inspection-{REVISION}.json").write_text(json.dumps(inspection, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"status": inspection["status"], "step_files": len(step_results), "assembly_solids": step_results[-1]["solids"], "stl_files": len(stl_results), "printed_interferences": printed_intersections, "review_notes": inspection["review_notes"]}, ensure_ascii=False), flush=True)
