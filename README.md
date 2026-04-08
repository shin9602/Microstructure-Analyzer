# AutoCalculator v1.0.0 (미세조직 분석 및 자동화 도구)

EBSD(Electron Backscatter Diffraction) 데이터 분석 및 재료 미세조직의 정량적 평가를 자동화하기 위한 전문 분석 툴입니다.

## 🚀 주요 개요

AutoCalculator는 재료공학 연구 및 품질 관리를 위해 복잡한 EBSD 데이터(.ang 파일 등) 처리를 자동화합니다. 고정밀 상 분율(Phase Volume Fraction) 계산, 강력한 결정립(Grain) 분석, 그리고 표준화된 경계 검출 기능을 제공하며 전문적인 리포트를 생성합니다.

## ✨ 주요 기능

- **EBSD 데이터 분석**: `.ang` 형식 및 주요 EBSD 데이터 완벽 지원.
- **결정립 크기 분포**: 결정립 크기를 빈도 기준뿐만 아니라 면적 가중치(Area-weighted)를 적용한 D10, D50, D90 수치로 산출.
- **정밀 상 분율 분석**: 이미지 노이즈 제거(Pre-smoothing) 파이프라인을 통한 정확한 결합상 분율 측정.
- **경계 특성 검출**: 표준화된 Sigma-2 및 CSL(Coincidence Site Lattice) 경계 검출 지원.
- **분석 결과 시각화**: 300 DPI의 고해상도 이미지 생성 및 Z-세로 방향 결정 배향(Orientation) 그래프 출력.
- **무설치 간편 실행 (Portable)**: 
  - `START_HERE.bat` 클릭 한 번으로 실행.
  - Node.js 및 Python이 없을 경우 자동으로 감지하여 내부 설치 및 환경 구성.
  - 웹 기반 인터페이스(React + TypeScript)를 통한 직관적인 대시보드.

## 🛠 기술 스택

- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Analysis Core**: Python (NumPy, SciPy, Matplotlib, OpenCV)
- **Launcher**: Windows 전용 이식형 배치(Batch) 시스템

## 📦 시작하기 (설치 및 실행)

1.  **리포지토리 클론 (또는 다운로드)**:
    ```bash
    git clone https://github.com/shin9602/Microstructure-Analyzer.git
    cd Microstructure-Analyzer
    ```
2.  **프로그램 실행**:
    - `START_HERE.bat` 파일을 더블 클릭하세요.
    - 실행에 필요한 모든 환경이 자동으로 구축되고 프로그램이 시작됩니다.

## 📊 추가 정보

- 분석 알고리즘에 대한 상세 내용은 `참고논문` 폴더 내의 자료를 확인하세요.
- 테스트용 데이터는 `예시파일` 폴더에 포함되어 있습니다.

---
*고성능 미세조직 정량 분석 및 시각화를 위해 개발되었습니다.*
