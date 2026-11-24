#!/usr/bin/env python3
"""
Pruebas automatizadas (casos positivos y negativos sintéticos) para validate-docs-consistency.py.
Tarea 20 — Auditoría y preparación del lanzamiento (2026-11-02).
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent / "validate-docs-consistency.py"
spec = importlib.util.spec_from_file_location("validate_docs_consistency", SCRIPT_PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
sys.modules["validate_docs_consistency"] = validator
spec.loader.exec_module(validator)


def build_synthetic_plan_maestro(
    accepted_count: int = 108,
    header_accepted: int = 108,
    header_open: int = 20,
    play_label: str = "Play23",
    backend_label: str = "workspace15",
) -> str:
    lines = [
        "# Plan Maestro de 128 Puntos en 9 Pasadas — PediTurno Servicios",
        "",
        f"**Corte de verificación:** 2 de noviembre de 2026 (`{play_label}` v23 en pista interna e instalada desde Google Play en `Samsung SM-A346M`, `{backend_label}` activo).",
        f"**Estado:** **Aceptados:** {header_accepted} / 128 (84.4%) · **Abiertos:** {header_open} · **En curso:** 0 · **Bloqueados:** 3",
        "",
        "| Pasada | Enfoque | Total | Aceptados | Abiertos |",
        "|---|---|---:|---:|---:|",
        f"| P1 | Sintética | 128 | {accepted_count} | {128 - accepted_count} |",
        "",
        "## Pasada 1 — Sintética",
        "",
        "| ID | Estado | Punto |",
        "|---|---|---|",
    ]
    for i in range(1, 129):
        status = "Aceptado" if i <= accepted_count else "Abierto"
        lines.append(f"| `{i:03d}` | {status} | Punto sintético {i:03d} |")
    return "\n".join(lines) + "\n"


def populate_clean_synthetic_repo(root: Path) -> None:
    docs_dir = root / "docs" / "android"
    docs_dir.mkdir(parents=True, exist_ok=True)
    out_dir = root / "output" / "p7-fotos23-20261102"
    out_dir.mkdir(parents=True, exist_ok=True)

    (docs_dir / "PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md").write_text(
        build_synthetic_plan_maestro(),
        encoding="utf-8",
    )
    (docs_dir / "API-CONTRACT.md").write_text(
        "# Contrato API\n\n**Estado contrastado 2/11/2026:** Play23 interna instalada, backend workspace15 activo.\n",
        encoding="utf-8",
    )
    (docs_dir / "ESTADO-HACIA-PRODUCCION-20261030.md").write_text(
        "# Estado hacia producción — 108/128 aceptados (84,4 %, Play23 + workspace15)\n\n"
        "**Actualizado 2/11:** 108/128 aceptados; Play23; workspace15.\n\n"
        "## Historial de cortes previos\n\n"
        "**Actualizado 1/11:** 96/128 aceptados; Play18; workspace14.\n",
        encoding="utf-8",
    )
    (docs_dir / "PASADA-7-20261030.md").write_text(
        "# Pasada 7\n\nEstado vigente: P7 7/10, acumulado 108/128.\n",
        encoding="utf-8",
    )
    (docs_dir / "FICHA-BINARIO-PLAY20-20261102.md").write_text(
        "# Ficha Binario Play20\n",
        encoding="utf-8",
    )
    (docs_dir / "FICHA-BINARIO-PLAY23-20261102.md").write_text(
        "# Ficha Binario Play23\n",
        encoding="utf-8",
    )

    (out_dir / "candidate23-verification.json").write_text(
        json.dumps(
            {
                "versionCode": validator.EXPECTED_VERSION_CODE,
                "aabSha256": validator.EXPECTED_AAB_SHA256,
                "universalApkSha256": validator.EXPECTED_APK_SHA256,
                "certificateSha256": validator.EXPECTED_CERT_SHA256,
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "play23-publication.json").write_text(
        json.dumps(
            {
                "versionCode": validator.EXPECTED_VERSION_CODE,
                "aabSha256": validator.EXPECTED_AAB_SHA256,
                "track": "internal",
                "productionTrackVersionCodes": [],
                "closedTrackVersionCodes": [6],
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "play23-installed.json").write_text(
        json.dumps(
            {
                "versionCode": validator.EXPECTED_VERSION_CODE,
                "installerPackageName": "com.android.vending",
                "device": "RFCW50VQDHH",
            }
        ),
        encoding="utf-8",
    )
    (out_dir / "matrix23.json").write_text(
        json.dumps({"aabSha256": validator.EXPECTED_AAB_SHA256}),
        encoding="utf-8",
    )
    (out_dir / "matrix23-consolidated.json").write_text(
        json.dumps({"aabSha256": validator.EXPECTED_AAB_SHA256}),
        encoding="utf-8",
    )


class ValidatorTests(unittest.TestCase):
    def test_positive_clean_synthetic_repo(self) -> None:
        """Caso positivo: repositorio sintético consistente con Play23, 108/128 y workspace15."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            populate_clean_synthetic_repo(root)
            report = validator.run_validation(root)
            self.assertEqual(report.error_count, 0, f"Errores inesperados: {report.findings}")
            self.assertEqual(report.warn_count, 0, f"Advertencias inesperadas: {report.findings}")
            self.assertEqual(report.plan_maestro_summary["counted_accepted"], 108)
            self.assertEqual(report.plan_maestro_summary["counted_open"], 20)

    def test_negative_plan_maestro_count_and_header_mismatch(self) -> None:
        """Caso negativo 1: cabecera dice 108/128 pero las filas suman 107/128 y cita Play22/workspace14."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            populate_clean_synthetic_repo(root)
            (root / "docs" / "android" / "PLAN-MAESTRO-128-PUNTOS-9-PASADAS.md").write_text(
                build_synthetic_plan_maestro(
                    accepted_count=107,
                    header_accepted=108,
                    header_open=20,
                    play_label="Play22",
                    backend_label="workspace14",
                ),
                encoding="utf-8",
            )
            report = validator.run_validation(root)
            codes = {f.code for f in report.findings}
            self.assertIn("PLAN_HEADER_COUNT_MISMATCH", codes)
            self.assertIn("PLAN_EXPECTED_108_MISMATCH", codes)
            self.assertIn("PLAN_HEADER_STALE_PLAY", codes)
            self.assertIn("PLAN_HEADER_STALE_BACKEND", codes)
            self.assertGreater(report.error_count, 0)

    def test_negative_artifact_hash_and_stale_docs(self) -> None:
        """Caso negativo 2: hash AAB alterado en candidate23 y cabeceras desactualizadas en docs activos."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            populate_clean_synthetic_repo(root)
            (root / "output" / "p7-fotos23-20261102" / "candidate23-verification.json").write_text(
                json.dumps(
                    {
                        "versionCode": 22,
                        "aabSha256": "0000000000000000000000000000000000000000000000000000000000000000",
                        "universalApkSha256": validator.EXPECTED_APK_SHA256,
                        "certificateSha256": validator.EXPECTED_CERT_SHA256,
                    }
                ),
                encoding="utf-8",
            )
            (root / "docs" / "android" / "API-CONTRACT.md").write_text(
                "# Contrato API\n\n**Estado contrastado 30/10/2026:** Play17 sólo interna, workspace14 activo.\n",
                encoding="utf-8",
            )
            (root / "docs" / "android" / "FICHA-BINARIO-PLAY23-20261102.md").unlink()
            report = validator.run_validation(root)
            codes = {f.code for f in report.findings}
            self.assertIn("ARTIFACT_CANDIDATE23_MISMATCH", codes)
            self.assertIn("DOC_ACTIVE_HEADER_STALE", codes)
            self.assertIn("DOC_FICHA_BINARIO_PLAY20_ONLY", codes)


if __name__ == "__main__":
    unittest.main(verbosity=2)
