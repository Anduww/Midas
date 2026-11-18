"""
Reporte de MIDAS en Excel: métricas activas (con su resultado), variables y resumen por proyecto.

Usa la API de MIDAS (el backend debe estar corriendo), así que no necesita
la contraseña de PostgreSQL. Solo lee; no modifica nada.

Uso (desde la carpeta del proyecto):
    pip install requests openpyxl
    python scripts/reporte_metricas.py
Opcional:
    python scripts/reporte_metricas.py --api http://localhost:3000 --salida reporte.xlsx
"""
import argparse
import getpass
import sys
from datetime import datetime

import requests
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter


def iniciar_sesion(api, email, clave):
    r = requests.post(f"{api}/login", json={"email": email, "password": clave}, timeout=15)
    if r.status_code != 200:
        sys.exit("No se pudo iniciar sesión: " + r.json().get("mensaje", str(r.status_code)))
    return r.json()["token"]


def pedir(api, ruta, token):
    r = requests.get(api + ruta, headers={"Authorization": "Bearer " + token}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"Error en {ruta}: " + r.json().get("mensaje", str(r.status_code)))
    return r.json()


def calcular(api, token, metrica):
    """Pide al backend el resultado de la ecuación (usa el mismo motor que el panel)."""
    r = requests.post(
        api + "/calculos/previsualizar",
        json={"proyecto_id": metrica["proyecto_id"], "ecuacion": metrica["ecuacion"]},
        headers={"Authorization": "Bearer " + token},
        timeout=30,
    )
    if r.status_code == 200:
        return r.json()["resultado"], ""
    return None, r.json().get("mensaje", "No se pudo calcular")


def fecha(valor):
    if not valor:
        return ""
    return datetime.fromisoformat(valor.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")


def hoja(wb, titulo, encabezados, filas):
    ws = wb.create_sheet(titulo)
    ws.append(encabezados)
    for celda in ws[1]:
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = PatternFill("solid", fgColor="1F3A5F")
        celda.alignment = Alignment(vertical="center")
    for fila in filas:
        ws.append(fila)
    for i, enc in enumerate(encabezados, start=1):
        ancho = max([len(str(enc))] + [len(str(f[i - 1])) for f in filas if f[i - 1] is not None])
        ws.column_dimensions[get_column_letter(i)].width = min(ancho + 3, 60)
    ws.freeze_panes = "A2"
    return ws


def main():
    ap = argparse.ArgumentParser(description="Reporte de MIDAS en Excel")
    ap.add_argument("--api", default="http://localhost:3000")
    ap.add_argument("--salida", default=f"reporte_midas_{datetime.now():%Y%m%d_%H%M}.xlsx")
    args = ap.parse_args()

    email = input("Correo (rol admin_super o admin): ").strip()
    clave = getpass.getpass("Contraseña: ")
    token = iniciar_sesion(args.api, email, clave)

    metricas = [m for m in pedir(args.api, "/calculos", token) if m["estado"] == "activa"]
    variables = pedir(args.api, "/variables", token)
    historial = pedir(args.api, "/historial", token)

    wb = Workbook()
    wb.remove(wb.active)

    # 1. Métricas activas con su resultado
    filas, por_proyecto = [], {}
    for m in metricas:
        resultado, error = calcular(args.api, token, m)
        filas.append([
            m["proyecto_nombre"], m["nombre"], m["nombre_tabla"], m["ecuacion"],
            resultado, error, "Tabla" if m["formato"] == "tabla" else "Texto plano",
            m["descripcion"] or "", fecha(m["enviada_en"]), m["creado_por"] or "",
        ])
        por_proyecto.setdefault(m["proyecto_nombre"], []).append(resultado)
    hoja(wb, "Métricas activas",
         ["Proyecto", "Métrica", "Tabla", "Ecuación", "Resultado", "Error", "Formato", "Descripción", "Enviada", "Quién creó"],
         filas)

    # 2. Variables
    hoja(wb, "Variables",
         ["Proyecto", "Variable", "País", "Dato", "Habilitada", "Bloqueada", "Creada", "Quién creó"],
         [[v["proyecto_nombre"] or "General", v["nombre"], v["pais"] or v["pais_codigo"] or "Global",
           float(v["valor"]), "Sí" if v["habilitada"] else "No", "Sí" if v["en_uso"] else "No",
           fecha(v["creado_en"]), v["creado_por"] or ""] for v in variables])

    # 3. Resumen por proyecto
    resumen = []
    for proyecto, resultados in sorted(por_proyecto.items(), key=lambda item: item[0] or ""):
        n_vars = sum(1 for v in variables if v["habilitada"] and v["proyecto_nombre"] == proyecto)
        resumen.append([proyecto, len(resultados), n_vars, sum(1 for x in resultados if x is None)])
    hoja(wb, "Resumen por proyecto", ["Proyecto", "Métricas activas", "Variables del proyecto", "Con error"], resumen)

    # 4. Historial (desactivadas)
    hoja(wb, "Desactivadas",
         ["Proyecto", "Métrica", "Tabla", "Ecuación", "Desactivada", "Quién la desactivó"],
         [[h["proyecto_nombre"], h["nombre"], h["nombre_tabla"] or "", h["ecuacion"],
           fecha(h["desactivada_en"]), h["desactivada_por"] or ""] for h in historial])

    wb.save(args.salida)
    print(f"Listo: {args.salida}  ({len(metricas)} métricas activas, {len(variables)} variables)")


if __name__ == "__main__":
    main()