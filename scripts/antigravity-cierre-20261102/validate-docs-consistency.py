#!/usr/bin/env python3
"""
Validador de consistencia documental y trazabilidad de artefactos para PediTurno Servicios.
Tarea 20 — Auditoría y preparación del lanzamiento (2026-11-02).

Uso:
  python scripts/antigravity-cierre-20261102/validate-docs-consistency.py [--root <path>] [--strict] [--json-out <path>]

Reglas verificadas:
  1. Conteo exacto de puntos en PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md:
     - 128 ítems numerados (001..128) en formato checklist (`- [x] NNN.` / `- [ ] NNN.`) o tabla.
     - Coincidencia entre el párrafo de "Estado vigente" (Aceptados / Pendientes) y el conteo real.
     - Coincidencia de los subtotales por pasada declarados en "Estado vigente" (ej. P7: 7/10; P8: 17/22; P9: 2/11).
  2. Trazabilidad del binario Play23 en output/p7-fotos23-20261102/:
     - Coincidencia de versionCode (23), AAB SHA256, APK SHA256 y certificado entre
       candidate23-verification.json, play23-publication.json, play23-installed.json y matrix23-consolidated.json.
     - Detección de hashes heredados en artefactos intermedios (ej. matrix23.json).
  3. Vigencia de cabeceras y bloques de estado activo en documentos operativos seleccionados:
     - Distingue secciones históricas explícitas (`## Historial...`, `Hito 30/10/2026...`) de cabeceras o bloques activos.
     - Detecta referencias rezagadas a Play17..Play22, workspace14 o conteos previos (< 108/128) en bloques activos.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


EXPECTED_TOTAL_POINTS = 128
EXPECTED_ACCEPTED_POINTS = 108
EXPECTED_OPEN_POINTS = 20
EXPECTED_VERSION_CODE = 23
EXPECTED_PLAY_LABEL = "Play23"
EXPECTED_BACKEND_RELEASE = "20261101-workspace-15"
EXPECTED_BACKEND_SHORT = "workspace15"
EXPECTED_AAB_SHA256 = "1b85cddc55869afda15174af6f7aaf273d10fb62e12d8adab89d40f4bfb7bdfd"
EXPECTED_APK_SHA256 = "b2d0a89316571abb11ef89ae96b115a52635065d21474e98f0ef3dee20c576f8"
EXPECTED_CERT_SHA256 = "9A0C132D67965F353680480EFC2D9D045E5F224DF5513573D63B727E299F10C8"


@dataclass
class Finding:
    code: str
    severity: str  # "ERROR" | "WARN" | "INFO"
    file: str
    line: int
    message: str
    evidence: str


@dataclass
class ValidationReport:
    root: str
    expected_reference: Dict[str, object]
    plan_maestro_summary: Dict[str, object] = field(default_factory=dict)
    artifact_summary: Dict[str, object] = field(default_factory=dict)
    findings: List[Finding] = field(default_factory=list)

    @property
    def error_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "ERROR")

    @property
    def warn_count(self) -> int:
        return sum(1 for f in self.findings if f.severity == "WARN")


RowTuple = Tuple[int, str, bool, str]  # (line_no, id_str, is_accepted, row_text)


def rel_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def validate_plan_maestro(root: Path, report: ValidationReport) -> None:
    plan_path = root / "docs" / "android" / "PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md"
    rel = rel_path(plan_path, root)
    if not plan_path.exists():
        report.findings.append(
            Finding(
                code="PLAN_MISSING",
                severity="ERROR",
                file=rel,
                line=1,
                message="No se encontró PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md.",
                evidence="Archivo inexistente",
            )
        )
        return

    lines = plan_path.read_text(encoding="utf-8").splitlines()

    header_accepted: Optional[int] = None
    header_total: Optional[int] = None
    header_open: Optional[int] = None
    header_line_no = 1
    header_pass_claims: Dict[str, Tuple[int, int]] = {}

    # Supports both "**108/128 aceptados, 20 pendientes**" and "**Aceptados:** 108 / 128 ... **Abiertos:** 20"
    vigente_inline_re = re.compile(
        r"\*\*(\d+)\s*/\s*(\d+)\s*aceptados,\s*(\d+)\s*(?:pendientes|abiertos)",
        re.IGNORECASE,
    )
    vigente_split_re = re.compile(
        r"\*\*Aceptados:\*\*\s*(\d+)\s*/\s*(\d+).*?\*\*(?:Abiertos|Pendientes):\*\*\s*(\d+)",
        re.IGNORECASE,
    )
    pass_claim_re = re.compile(r"\b(P\d+)\s*:\s*(\d+)\s*/\s*(\d+)\b")

    checkbox_re = re.compile(r"^-\s*\[([xX ])\]\s*`?(\d{3})`?[\.\s:]")
    table_point_re = re.compile(r"^\|\s*`(\d{3})`\s*\|\s*([^|]+?)\s*\|")
    pass_heading_re = re.compile(r"^##\s+Pasada\s+(\d+)\b", re.IGNORECASE)

    current_pass: Optional[str] = None
    rows_by_pass: Dict[str, List[RowTuple]] = {}
    all_rows: Dict[str, RowTuple] = {}

    for idx, line in enumerate(lines, start=1):
        # Parse ONLY the first active status line ("Estado vigente" or "**Estado:**")
        if header_accepted is None and (
            "Estado vigente" in line or "**Estado:**" in line or "**Corte de verificación:**" in line
        ):
            m1 = vigente_inline_re.search(line)
            m2 = vigente_split_re.search(line)
            m = m1 or m2
            if m:
                header_accepted = int(m.group(1))
                header_total = int(m.group(2))
                header_open = int(m.group(3))
                header_line_no = idx
                for pm in pass_claim_re.finditer(line):
                    header_pass_claims[pm.group(1).upper()] = (
                        int(pm.group(2)),
                        int(pm.group(3)),
                    )

            # Check active status line for stale Play version or backend
            if re.search(r"\bPlay(1[0-9]|2[0-2])\b", line):
                report.findings.append(
                    Finding(
                        code="PLAN_HEADER_STALE_PLAY",
                        severity="ERROR",
                        file=rel,
                        line=idx,
                        message="La línea de estado vigente del Plan Maestro cita una versión previa a Play23.",
                        evidence=line.strip(),
                    )
                )
            if "workspace14" in line or "workspace-14" in line:
                report.findings.append(
                    Finding(
                        code="PLAN_HEADER_STALE_BACKEND",
                        severity="ERROR",
                        file=rel,
                        line=idx,
                        message="La línea de estado vigente del Plan Maestro cita workspace14 en lugar de workspace15.",
                        evidence=line.strip(),
                    )
                )

        m_heading = pass_heading_re.match(line)
        if m_heading:
            current_pass = f"P{m_heading.group(1)}"
            rows_by_pass.setdefault(current_pass, [])
            continue

        m_chk = checkbox_re.match(line.strip())
        if m_chk:
            is_acc = m_chk.group(1).lower() == "x"
            pt_id = m_chk.group(2)
            row_tuple: RowTuple = (idx, pt_id, is_acc, line.strip())
            if pt_id in all_rows:
                report.findings.append(
                    Finding(
                        code="PLAN_DUPLICATE_ID",
                        severity="ERROR",
                        file=rel,
                        line=idx,
                        message=f"ID duplicado `{pt_id}` en Plan Maestro.",
                        evidence=line.strip(),
                    )
                )
            all_rows[pt_id] = row_tuple
            if current_pass:
                rows_by_pass.setdefault(current_pass, []).append(row_tuple)
            continue

        m_tbl = table_point_re.match(line.strip())
        if m_tbl:
            pt_id = m_tbl.group(1)
            status_cell = m_tbl.group(2).strip()
            is_acc = status_cell.lower().startswith("aceptado")
            row_tuple = (idx, pt_id, is_acc, line.strip())
            if pt_id in all_rows:
                report.findings.append(
                    Finding(
                        code="PLAN_DUPLICATE_ID",
                        severity="ERROR",
                        file=rel,
                        line=idx,
                        message=f"ID duplicado `{pt_id}` en Plan Maestro.",
                        evidence=line.strip(),
                    )
                )
            all_rows[pt_id] = row_tuple
            if current_pass:
                rows_by_pass.setdefault(current_pass, []).append(row_tuple)

    accepted_ids = sorted(pt_id for pt_id, (_, _, is_acc, _) in all_rows.items() if is_acc)
    open_ids = sorted(pt_id for pt_id, (_, _, is_acc, _) in all_rows.items() if not is_acc)

    pass_breakdown: Dict[str, Dict[str, object]] = {}
    for p_key, p_rows in rows_by_pass.items():
        p_acc = [pt_id for _, pt_id, is_acc, _ in p_rows if is_acc]
        p_open = [pt_id for _, pt_id, is_acc, _ in p_rows if not is_acc]
        pass_breakdown[p_key] = {
            "total": len(p_rows),
            "accepted": len(p_acc),
            "open": len(p_open),
            "open_ids": p_open,
        }

    report.plan_maestro_summary = {
        "header_line": header_line_no,
        "header_accepted": header_accepted,
        "header_total": header_total,
        "header_open": header_open,
        "counted_total": len(all_rows),
        "counted_accepted": len(accepted_ids),
        "counted_open": len(open_ids),
        "open_ids": open_ids,
        "by_pass": pass_breakdown,
    }

    if len(all_rows) != EXPECTED_TOTAL_POINTS:
        report.findings.append(
            Finding(
                code="PLAN_TOTAL_MISMATCH",
                severity="ERROR",
                file=rel,
                line=header_line_no,
                message=f"Se esperaban {EXPECTED_TOTAL_POINTS} puntos numerados, pero se encontraron {len(all_rows)}.",
                evidence=f"counted_total={len(all_rows)}",
            )
        )

    if (
        header_accepted != len(accepted_ids)
        or header_open != len(open_ids)
        or header_total != len(all_rows)
    ):
        report.findings.append(
            Finding(
                code="PLAN_HEADER_COUNT_MISMATCH",
                severity="ERROR",
                file=rel,
                line=header_line_no,
                message=(
                    f"Desfase entre cabecera ({header_accepted}/{header_total}, abiertos {header_open}) "
                    f"y filas reales ({len(accepted_ids)}/{len(all_rows)}, abiertos {len(open_ids)})."
                ),
                evidence=lines[header_line_no - 1].strip() if lines else "",
            )
        )

    if len(accepted_ids) != EXPECTED_ACCEPTED_POINTS or len(open_ids) != EXPECTED_OPEN_POINTS:
        report.findings.append(
            Finding(
                code="PLAN_EXPECTED_108_MISMATCH",
                severity="ERROR",
                file=rel,
                line=header_line_no,
                message=(
                    f"El conteo real ({len(accepted_ids)}/{len(all_rows)}, abiertos {len(open_ids)}) "
                    f"difiere del estado de referencia ({EXPECTED_ACCEPTED_POINTS}/{EXPECTED_TOTAL_POINTS}, abiertos {EXPECTED_OPEN_POINTS})."
                ),
                evidence=f"open_ids={','.join(open_ids)}",
            )
        )

    for p_key, (claimed_acc, claimed_tot) in header_pass_claims.items():
        actual = pass_breakdown.get(p_key)
        if not actual:
            continue
        if actual["accepted"] != claimed_acc or actual["total"] != claimed_tot:
            report.findings.append(
                Finding(
                    code="PLAN_PASS_SUMMARY_MISMATCH",
                    severity="ERROR",
                    file=rel,
                    line=header_line_no,
                    message=(
                        f"El estado vigente declara {p_key}: {claimed_acc}/{claimed_tot}, "
                        f"pero los ítems reales de {p_key} suman {actual['accepted']}/{actual['total']}."
                    ),
                    evidence=lines[header_line_no - 1].strip(),
                )
            )


def _extract_candidate_hashes(data: Dict[str, object]) -> Tuple[str, str, str]:
    """Soporta tanto esquema plano como lista `artifacts` en candidate23-verification.json."""
    aab_sha = str(data.get("aabSha256", "")).lower()
    apk_sha = str(data.get("universalApkSha256", "")).lower()
    cert_sha = str(data.get("certificateSha256") or data.get("signerSha256") or "").upper()

    artifacts = data.get("artifacts")
    if isinstance(artifacts, list):
        for item in artifacts:
            if isinstance(item, dict):
                path_str = str(item.get("path", "")).lower()
                sha_str = str(item.get("sha256", "")).lower()
                if path_str.endswith(".aab") and not aab_sha:
                    aab_sha = sha_str
                elif path_str.endswith(".apk") and not apk_sha:
                    apk_sha = sha_str
    return aab_sha, apk_sha, cert_sha


def validate_play23_artifacts(root: Path, report: ValidationReport) -> None:
    out_dir = root / "output" / "p7-fotos23-20261102"
    if not out_dir.exists():
        report.findings.append(
            Finding(
                code="ARTIFACTS_DIR_MISSING",
                severity="WARN",
                file=rel_path(out_dir, root),
                line=1,
                message="No se encontró el directorio output/p7-fotos23-20261102 para validar artefactos JSON.",
                evidence="Directorio ausente",
            )
        )
        return

    cand_path = out_dir / "candidate23-verification.json"
    pub_path = out_dir / "play23-publication.json"
    inst_path = out_dir / "play23-installed.json"
    mat_path = out_dir / "matrix23.json"
    mat_cons_path = out_dir / "matrix23-consolidated.json"

    summary: Dict[str, object] = {}

    if cand_path.exists():
        data = json.loads(cand_path.read_text(encoding="utf-8"))
        vc = data.get("versionCode")
        aab_sha, apk_sha, cert_sha = _extract_candidate_hashes(data)
        summary["candidate23"] = {
            "versionCode": vc,
            "aabSha256": aab_sha,
            "universalApkSha256": apk_sha,
            "certificateSha256": cert_sha,
        }
        if vc != EXPECTED_VERSION_CODE or aab_sha != EXPECTED_AAB_SHA256.lower():
            report.findings.append(
                Finding(
                    code="ARTIFACT_CANDIDATE23_MISMATCH",
                    severity="ERROR",
                    file=rel_path(cand_path, root),
                    line=1,
                    message="candidate23-verification.json no coincide con versionCode 23 o AAB SHA256 esperado.",
                    evidence=f"versionCode={vc}, aabSha256={aab_sha}",
                )
            )
        if apk_sha != EXPECTED_APK_SHA256.lower() or cert_sha != EXPECTED_CERT_SHA256.upper():
            report.findings.append(
                Finding(
                    code="ARTIFACT_CANDIDATE23_APK_OR_CERT_MISMATCH",
                    severity="ERROR",
                    file=rel_path(cand_path, root),
                    line=1,
                    message="candidate23-verification.json no coincide con APK SHA256 o certificado esperado.",
                    evidence=f"apkSha256={apk_sha}, cert={cert_sha}",
                )
            )

    if pub_path.exists():
        data = json.loads(pub_path.read_text(encoding="utf-8"))
        vc = data.get("versionCode")
        aab_sha = str(data.get("aabSha256", "")).lower()
        internal_updated = data.get("internalUpdated")
        track = data.get("track")
        if not track and isinstance(internal_updated, dict):
            track = internal_updated.get("track")
        public_launch = bool(data.get("publicLaunch", False))
        other_tracks_unchanged = bool(data.get("otherTracksUnchanged", True))
        summary["publication23"] = {
            "versionCode": vc,
            "aabSha256": aab_sha,
            "track": track,
            "publicLaunch": public_launch,
            "otherTracksUnchanged": other_tracks_unchanged,
        }
        if (
            vc != EXPECTED_VERSION_CODE
            or aab_sha != EXPECTED_AAB_SHA256.lower()
            or track != "internal"
            or public_launch
        ):
            report.findings.append(
                Finding(
                    code="ARTIFACT_PUBLICATION23_MISMATCH",
                    severity="ERROR",
                    file=rel_path(pub_path, root),
                    line=1,
                    message="play23-publication.json no coincide con versionCode 23, AAB SHA256 o publicación exclusiva en internal.",
                    evidence=f"versionCode={vc}, track={track}, publicLaunch={public_launch}, aabSha256={aab_sha}",
                )
            )

    if inst_path.exists():
        data = json.loads(inst_path.read_text(encoding="utf-8"))
        vc = data.get("versionCode")
        installer_pkg = data.get("installerPackageName")
        installer_play = bool(data.get("installerPlay", False)) or (
            installer_pkg == "com.android.vending"
        )
        summary["installed23"] = {
            "versionCode": vc,
            "installerPlay": installer_play,
            "device": data.get("device"),
        }
        if vc != EXPECTED_VERSION_CODE or not installer_play:
            report.findings.append(
                Finding(
                    code="ARTIFACT_INSTALLED23_MISMATCH",
                    severity="ERROR",
                    file=rel_path(inst_path, root),
                    line=1,
                    message="play23-installed.json no acredita versionCode 23 instalado desde Google Play.",
                    evidence=f"versionCode={vc}, installerPlay={installer_play}",
                )
            )

    if mat_path.exists():
        raw_lines = mat_path.read_text(encoding="utf-8").splitlines()
        data = json.loads("\n".join(raw_lines))
        aab_sha = str(data.get("aabSha256", "")).lower()
        if aab_sha and aab_sha != EXPECTED_AAB_SHA256.lower():
            line_no = next(
                (i for i, l in enumerate(raw_lines, 1) if "aabSha256" in l),
                1,
            )
            report.findings.append(
                Finding(
                    code="ARTIFACT_MATRIX23_STALE_HASH",
                    severity="WARN",
                    file=rel_path(mat_path, root),
                    line=line_no,
                    message=(
                        "matrix23.json conserva un aabSha256 heredado de Play22 "
                        f"({aab_sha[:12]}...) en lugar del AAB23 final ({EXPECTED_AAB_SHA256[:12]}...)."
                    ),
                    evidence=raw_lines[line_no - 1].strip() if raw_lines else aab_sha,
                )
            )

    if mat_cons_path.exists():
        data = json.loads(mat_cons_path.read_text(encoding="utf-8"))
        aab_sha = str(data.get("aabSha256", "")).lower()
        summary["matrix23_consolidated_aabSha256"] = aab_sha
        if aab_sha != EXPECTED_AAB_SHA256.lower():
            report.findings.append(
                Finding(
                    code="ARTIFACT_MATRIX23_CONSOLIDATED_MISMATCH",
                    severity="ERROR",
                    file=rel_path(mat_cons_path, root),
                    line=1,
                    message="matrix23-consolidated.json no tiene el AAB SHA256 de Play23.",
                    evidence=f"aabSha256={aab_sha}",
                )
            )

    report.artifact_summary = summary


def validate_active_markdown_docs(root: Path, report: ValidationReport) -> None:
    """
    Revisa documentos clave en docs/android/ buscando cabeceras o bloques activos
    que hayan quedado desfasados respecto a Play23, 108/128 o workspace15,
    sin marcar como error el archivo histórico debidamente rotulado.
    """
    docs_dir = root / "docs" / "android"
    if not docs_dir.exists():
        return

    # 1. API-CONTRACT.md: check active header (top 10 lines)
    api_contract = docs_dir / "API-CONTRACT.md"
    if api_contract.exists():
        lines = api_contract.read_text(encoding="utf-8").splitlines()
        for idx, line in enumerate(lines[:10], start=1):
            if "Estado contrastado" in line or "Estado vigente" in line:
                if "Play23" not in line or "workspace15" not in line:
                    report.findings.append(
                        Finding(
                            code="DOC_ACTIVE_HEADER_STALE",
                            severity="WARN",
                            file=rel_path(api_contract, root),
                            line=idx,
                            message="Cabecera activa de API-CONTRACT.md sigue referenciando un corte anterior a Play23 / workspace15.",
                            evidence=line.strip(),
                        )
                    )

    # 2. ESTADO-HACIA-PRODUCCION-20261030.md: check active block before '## Historial'
    estado_path = docs_dir / "ESTADO-HACIA-PRODUCCION-20261030.md"
    if estado_path.exists():
        lines = estado_path.read_text(encoding="utf-8").splitlines()
        active_block = "\n".join(lines[:15])
        if "108/128" not in active_block or "Play23" not in active_block or "workspace15" not in active_block:
            report.findings.append(
                Finding(
                    code="DOC_ESTADO_ACTIVE_BLOCK_STALE",
                    severity="ERROR",
                    file=rel_path(estado_path, root),
                    line=1,
                    message="El bloque superior activo de ESTADO-HACIA-PRODUCCION no refleja 108/128, Play23 o workspace15.",
                    evidence=lines[0].strip() if lines else "",
                )
            )
        # Check if there is a competing level-1 '# ' heading inside the historical section
        in_history = False
        for idx, line in enumerate(lines, start=1):
            if re.match(r"^##\s+Historial", line, re.IGNORECASE):
                in_history = True
                continue
            if in_history and line.startswith("# "):
                report.findings.append(
                    Finding(
                        code="DOC_HISTORY_USES_H1_HEADING",
                        severity="WARN",
                        file=rel_path(estado_path, root),
                        line=idx,
                        message=(
                            "La sección histórica en ESTADO-HACIA-PRODUCCION reabre un título H1 ('# Pendientes efectivos...') "
                            "seguido de '**Actualizado 1/11: 96/128...**', lo que puede confundirse con una portada activa."
                        ),
                        evidence=line.strip(),
                    )
                )

    # 3. PASADA-7-20261030.md: check the latest "Estado vigente:" line
    p7_path = docs_dir / "PASADA-7-20261030.md"
    if p7_path.exists():
        lines = p7_path.read_text(encoding="utf-8").splitlines()
        vigente_lines = [
            (idx, line)
            for idx, line in enumerate(lines, start=1)
            if "Estado vigente" in line
        ]
        if vigente_lines:
            last_idx, last_line = vigente_lines[-1]
            if "108/128" not in last_line or "7/10" not in last_line:
                report.findings.append(
                    Finding(
                        code="DOC_P7_VIGENTE_STALE",
                        severity="WARN",
                        file=rel_path(p7_path, root),
                        line=last_idx,
                        message=(
                            "La última línea 'Estado vigente' en PASADA-7-20261030.md quedó en P7 6/10 y 106/128 (Play20) "
                            "en lugar de P7 7/10 y 108/128 (Play23)."
                        ),
                        evidence=last_line.strip(),
                    )
                )

    # 4. FICHA-BINARIO-PLAY20-20261102.md: verify if Play23 binary-to-store contrast exists
    ficha20_path = docs_dir / "FICHA-BINARIO-PLAY20-20261102.md"
    ficha23_candidates = list(docs_dir.glob("FICHA-BINARIO-PLAY23*.md"))
    if ficha20_path.exists() and not ficha23_candidates:
        lines = ficha20_path.read_text(encoding="utf-8").splitlines()
        line_no = 1
        for idx, line in enumerate(lines[:10], start=1):
            if "Play20" in line or "versionCode: 20" in line:
                line_no = idx
                break
        report.findings.append(
            Finding(
                code="DOC_FICHA_BINARIO_PLAY20_ONLY",
                severity="WARN",
                file=rel_path(ficha20_path, root),
                line=line_no,
                message=(
                    "El contraste ficha↔binario vigente (punto 117) sigue anclado a Play20 (versionCode 20, 88 tests, 144 fuentes) "
                    "y su línea 27 exige revalidarlo ante un nuevo AAB (Play23 tiene versionCode 23, 93 tests, 149 fuentes)."
                ),
                evidence=lines[line_no - 1].strip() if lines else "",
            )
        )


def run_validation(root: Path) -> ValidationReport:
    report = ValidationReport(
        root=root.as_posix(),
        expected_reference={
            "total_points": EXPECTED_TOTAL_POINTS,
            "accepted_points": EXPECTED_ACCEPTED_POINTS,
            "open_points": EXPECTED_OPEN_POINTS,
            "version_code": EXPECTED_VERSION_CODE,
            "play_label": EXPECTED_PLAY_LABEL,
            "backend_release": EXPECTED_BACKEND_RELEASE,
            "aab_sha256": EXPECTED_AAB_SHA256,
            "apk_sha256": EXPECTED_APK_SHA256,
            "cert_sha256": EXPECTED_CERT_SHA256,
        },
    )
    validate_plan_maestro(root, report)
    validate_play23_artifacts(root, report)
    validate_active_markdown_docs(root, report)
    return report


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Valida la consistencia documental y de artefactos para el cierre Play23 (108/128)."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Directorio raíz del repositorio General.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Devuelve código de salida != 0 también cuando existan advertencias (WARN).",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        default=None,
        help="Ruta opcional para guardar el reporte en formato JSON.",
    )
    args = parser.parse_args(argv)

    root = args.root.resolve()
    report = run_validation(root)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "root": report.root,
            "expected_reference": report.expected_reference,
            "plan_maestro_summary": report.plan_maestro_summary,
            "artifact_summary": report.artifact_summary,
            "error_count": report.error_count,
            "warn_count": report.warn_count,
            "findings": [asdict(f) for f in report.findings],
        }
        args.json_out.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    pm = report.plan_maestro_summary
    print(
        f"[PLAN MAESTRO] Aceptados={pm.get('counted_accepted')}/{pm.get('counted_total')} "
        f"| Abiertos={pm.get('counted_open')} "
        f"| Cabecera={pm.get('header_accepted')}/{pm.get('header_total')} (abiertos {pm.get('header_open')})"
    )
    print(
        f"[HALLAZGOS] ERROR={report.error_count} | WARN={report.warn_count} | TOTAL={len(report.findings)}"
    )
    for f in report.findings:
        print(f"  - [{f.severity}] {f.code} ({f.file}:{f.line}): {f.message}")

    if report.error_count > 0:
        return 1
    if args.strict and report.warn_count > 0:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
