"""Regenera app/data/planes.js desde el Excel del sistema.
Uso:  pip install openpyxl
      python3 herramientas/actualizar_catalogo.py "Sistema de Predictamen de Equivalencias IUV.xlsx"
"""
import json, re, sys, pathlib
import openpyxl

xlsx = sys.argv[1] if len(sys.argv) > 1 else str(pathlib.Path(__file__).parents[1] / 'Sistema de Predictamen de Equivalencias IUV.xlsx')
salida = pathlib.Path(__file__).parents[1] / 'app' / 'data' / 'planes.js'
wb = openpyxl.load_workbook(xlsx)

def rv(x):
    return str(int(x)) if isinstance(x, float) and x.is_integer() else str(x).strip()

planes, orden = {}, []
for r in wb['MATERIA_IUV'].iter_rows(min_row=2, values_only=True):
    if r[0] is None or not r[5]:
        continue
    rvoe, niv, nom, mod, per, mat = rv(r[0]), *(str(v).strip() for v in r[1:6])
    if re.search(r'\bmeses\b|duraci[oó]n|^total', mat, re.I):
        continue
    k = f'{rvoe}|{mod}'
    if k not in planes:
        planes[k] = {'id': k, 'rvoe': rvoe, 'nivel': niv, 'nombre': nom, 'modalidad': mod, 'materias': []}
        orden.append(k)
    m = re.match(r'(\d+)', per)
    planes[k]['materias'].append({'c': int(m.group(1)) if m else 0, 'n': mat})
    planes[k]['unidad'] = 'semestre' if 'semestre' in per.lower() else 'cuatrimestre'

cfg = {r[0]: r[1] for r in wb['CONFIGURACION'].iter_rows(min_row=2, values_only=True) if r[0]}

# Equivalencias ya validadas en los dictámenes (hojas DICT_*)
pares = set()
for ws in wb.worksheets:
    if not ws.title.startswith('DICT_'):
        continue
    for r in ws.iter_rows(min_row=10, values_only=True):
        iuv, orig = r[2], r[3]
        if iuv and isinstance(orig, str) and not re.search(r'cursar|cursando|\d{4}', orig, re.I):
            pares.update((o.strip(), str(iuv).strip()) for o in orig.split(' / ') if o.strip())

salida.write_text(
    '// Generado desde "Sistema de Predictamen de Equivalencias IUV.xlsx" (hojas MATERIA_IUV, CONFIGURACION y DICT_*)\n'
    f'window.PLANES_IUV = {json.dumps([planes[k] for k in orden], ensure_ascii=False)};\n'
    f'window.CONFIG_IUV = {json.dumps(cfg)};\n'
    '// [materia de origen, materia IUV] ya validadas por un asesor\n'
    f'window.EQUIV_CONOCIDAS = {json.dumps(sorted(pares), ensure_ascii=False)};\n', encoding='utf-8')
print(f'{len(orden)} planes, {sum(len(p["materias"]) for p in planes.values())} materias, {len(pares)} equivalencias conocidas -> {salida}')
