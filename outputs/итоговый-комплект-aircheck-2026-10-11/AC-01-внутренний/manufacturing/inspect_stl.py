"""Inspect OCS binary STL exports and orient the lid on the print bed (mm)."""
import collections
import json
import math
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parent

def read(path):
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    assert len(data) == 84 + count * 50, (path, len(data), count)
    return [struct.unpack_from('<12fH', data, 84+i*50) for i in range(count)]

def inspect(path):
    rows = read(path)
    edges = collections.Counter()
    verts = []
    volume = 0
    degenerate = 0
    for row in rows:
        a,b,c = [tuple(round(v, 5) for v in row[i:i+3]) for i in (3,6,9)]
        verts.extend((a,b,c))
        for u,v in ((a,b),(b,c),(c,a)):
            edges[tuple(sorted((u,v)))] += 1
        cross = (b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0])
        volume += sum(a[i]*cross[i] for i in range(3))/6
        ab=[b[i]-a[i] for i in range(3)]; ac=[c[i]-a[i] for i in range(3)]
        area2=sum(v*v for v in (ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]))
        degenerate += area2 < 1e-14
    return dict(file=path.name, triangles=len(rows), bounds_min=[min(v[i] for v in verts) for i in range(3)],
                bounds_max=[max(v[i] for v in verts) for i in range(3)], signed_volume_mm3=volume,
                boundary_edges=sum(n==1 for n in edges.values()), nonmanifold_edges=sum(n>2 for n in edges.values()), degenerate_triangles=degenerate,
                method='binary STL; vertices welded to 0.00001 mm; each undirected edge must occur twice')

if __name__ == '__main__':
    base=ROOT/'AC-01-001-base-raw-R01.stl'
    clean=ROOT/'AC-01-001-base-print-R01.stl'
    if base.exists() and not clean.exists():
        kept=[]; seen=set()
        for row in read(base):
            a,b,c=[tuple(round(v,5) for v in row[i:i+3]) for i in (3,6,9)]
            ab=[b[i]-a[i] for i in range(3)]; ac=[c[i]-a[i] for i in range(3)]
            cross=(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])
            key=tuple(sorted((a,b,c)))
            if sum(v*v for v in cross)<1e-14 or key in seen: continue
            seen.add(key); kept.append(row)
        with clean.open('wb') as f:
            f.write(b'OCS base mm; removed zero-area and duplicate export triangles'.ljust(80,b' ')); f.write(struct.pack('<I',len(kept)))
            for row in kept: f.write(struct.pack('<12fH',*row))
    source=ROOT/'AC-01-002-lid-assembly-position.stl'
    target=ROOT/'AC-01-002-lid-print.stl'
    if source.exists() and not target.exists():
        rows=read(source)
        with target.open('wb') as f:
            f.write(b'AC-01-002 mm; rigid rotation 180 deg about X, translate (0,190,68)'.ljust(80,b' '))
            f.write(struct.pack('<I',len(rows)))
            for row in rows:
                vals=[row[0],-row[1],-row[2]]
                for i in (3,6,9): vals.extend((row[i],190-row[i+1],68-row[i+2]))
                f.write(struct.pack('<12fH',*vals,row[12]))
    results=[inspect(p) for p in ROOT.glob('*.stl')]
    (ROOT/'stl-inspection.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results,indent=2))
