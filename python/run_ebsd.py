"""Single entry point for phase-aware basic and advanced EBSD analysis."""
import argparse
import csv
import json
import os
from pathlib import Path
import sys
import traceback
import uuid
import zipfile

os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("NUMBA_CACHE_DIR", str(Path(__file__).resolve().parent / ".temp_ebsd" / ".numba_cache"))
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


def emit(payload):
    print("JSON_DATA:" + json.dumps(payload, ensure_ascii=True, allow_nan=False), flush=True)


def clean(value):
    import numpy as np
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--uploaded")
    parser.add_argument("--output", required=True)
    parser.add_argument("--co-wt", type=float)
    parser.add_argument("--comp-map", default="{}")
    args = parser.parse_args()
    folder = args.uploaded
    if not folder:
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            folder = filedialog.askdirectory(title="EBSD .ang / .osc 폴더 선택")
            root.destroy()
        except ImportError:
            # Portable Python omits Tk. Use the native Windows folder picker.
            if sys.platform != "win32":
                raise
            import subprocess
            script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='EBSD .ang / .osc'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}; $d.Dispose()"
            selected = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-Command", script], capture_output=True, encoding="utf-8", check=True)
            folder = selected.stdout.strip()
        if not folder:
            raise ValueError("폴더 선택이 취소되었습니다.")
    source = Path(folder)
    output_root = Path(args.output).resolve()
    run_dir = output_root / "runs" / uuid.uuid4().hex
    run_dir.mkdir(parents=True)
    inputs = sorted(source.glob("*.ang"))
    ang_names = {p.stem.casefold() for p in inputs}
    inputs += [p for p in sorted(source.glob("*.osc")) if p.stem.casefold() not in ang_names]
    if not inputs:
        raise ValueError("분석할 .ang / .osc 파일이 없습니다.")
    from microstructure_analysis import process_combined_microstructure
    from advanced_microstructure import process_advanced_wc
    from osc_to_ang import convert_osc_to_ang
    overrides = json.loads(args.comp_map)
    records, errors = [], []
    for index, file in enumerate(inputs):
        file_out = run_dir / f"sample_{index + 1:03d}"
        file_out.mkdir()
        record = {"name": file.stem, "basic": None, "advanced": None, "warnings": [], "images": []}
        co_wt = overrides.get(file.with_suffix(".ang").name, args.co_wt)
        try:
            emit({"type": "progress", "message": f"{file.name} · 데이터 로드", "percent": int(index / len(inputs) * 100)})
            analysis_file = file
            if file.suffix.lower() == ".osc":
                analysis_file = convert_osc_to_ang(file, file_out / file.with_suffix(".ang").name)
            record["basic"] = process_combined_microstructure(str(analysis_file), str(file_out), co_wt)
            if record["basic"] is None:
                raise ValueError("기본 분석 실패: 위의 파일/상 정보 오류를 확인하세요.")
            audit = record["basic"]["PhaseAudit"]
            integrity = audit.get("file_integrity", {})
            if integrity.get("has_errors"):
                record["file_error"] = "파일에 오류가 있습니다. " + " ".join(integrity["details"]) + f" 손상·누락 등을 포함해 {audit['source_excluded_points']:,}개 측정점이 제외되었습니다. 결과는 읽을 수 있는 데이터만으로 계산한 부분 분석입니다."
                emit({"type": "warning", "message": f"{file.name}: {record['file_error']}"})
            if audit["source_excluded_points"]:
                record["warnings"].append(f"원본 격자 {audit['source_total_points']:,}점 중 {audit['source_excluded_points']:,}점은 IQ 누락·손상 지점으로 제외했습니다. 손상된 수치는 추정 복원하지 않았습니다. 상 분율은 유효 영역 기준입니다.")
            if audit["source_phase_ids"]["Other"]:
                record["warnings"].append(f"기타 원본 상 {audit['source_phase_ids']['Other']}은 감마상으로 지정하지 않고 기존 WC–Co IQ 분할 대상에 포함했습니다.")
            emit({"type": "progress", "message": f"{file.name} · 형상·방위 분석", "percent": int((index + 0.5) / len(inputs) * 100)})
            try:
                record["advanced"] = process_advanced_wc(str(analysis_file), str(file_out), co_wt)
                if record["advanced"] is None:
                    raise ValueError("고급 지표를 계산하지 못했습니다.")
                if record["advanced"].get("T_Idx") is None:
                    record["warnings"].append("집합조직 지수(T-Index)는 현재 계산되지 않아 미제공으로 표시합니다.")
            except Exception as error:
                record["warnings"].append(f"형상·방위 분석: {error}")
                print(traceback.format_exc(), flush=True)
            record["images"] = [p.relative_to(output_root).as_posix() for p in sorted(file_out.glob("*.png"))]
            record["image_data"] = {}
            for image_path in sorted(file_out.glob("*.png")):
                data_files = [image_path.with_suffix('.csv'), image_path.with_name(image_path.stem + '_raw.csv')]
                available = [p.relative_to(output_root).as_posix() for p in data_files if p.exists()]
                if available:
                    record["image_data"][image_path.relative_to(output_root).as_posix()] = available
            records.append(clean(record))
        except Exception as error:
            errors.append({"name": file.name, "message": "파일 읽기 또는 분석에 오류가 있습니다. " + str(error)})
            print(traceback.format_exc(), flush=True)
    if not records:
        emit({"type": "error", "message": "모든 파일의 분석이 실패했습니다. " + "; ".join(e["message"] for e in errors)})
        return 1
    report = {"samples": records, "errors": errors}
    json_path = run_dir / "EBSD_results.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    csv_path = run_dir / "EBSD_summary.csv"
    rows = []
    for record in records:
        row = {"Filename": record["name"]}
        for section in ("basic", "advanced"):
            row.update({f"{section}_{key}": value for key, value in (record[section] or {}).items() if key not in ("PhaseAudit", "Filename")})
        row["Warnings"] = "; ".join(record["warnings"])
        rows.append(row)
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with csv_path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    txt_path = run_dir / "EBSD_report.txt"
    with txt_path.open("w", encoding="utf-8") as stream:
        stream.write("EBSD 통합 분석 결과\n입도: 등가원직경(µm), 입계 기준: 5°, CI ≥ 0.1\n기본 입도: 보간 후 / 형상·방위 입도: 외곽 10px 및 5px 미만 입자 제외\nCo 입력값: WC-Co 영역 중량비 기준, IQ 순위로 위치 추정. 최종 비율은 입자 정리 후 달라질 수 있습니다.\n\n")
        stream.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    archive = run_dir / "EBSD_all_results.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(run_dir.rglob("*")):
            if file.is_file() and file.suffix.lower() in (".png", ".txt", ".csv", ".json"):
                bundle.write(file, file.relative_to(run_dir))
    result = {"type": "result_pack", "mode": "combined", **report,
              "images": [image for record in records for image in record["images"]]}
    for key, file in (("txt", txt_path), ("csv", csv_path), ("json", json_path), ("zip", archive)):
        result[key] = file.relative_to(output_root).as_posix()
    emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
