# AutoCalculator v1.0.0

A professional-grade microstructure analysis and automation tool designed for processing EBSD (Electron Backscatter Diffraction) data and performing advanced morphological analysis.

## 🚀 Overview

AutoCalculator is a comprehensive solution for materials scientists and engineers to automate the analysis of microstructure data. It provides high-precision phase volume fraction calculation, robust grain analysis, and standardized boundary detection with professional reporting capabilities.

## ✨ Key Features

- **Advanced EBSD Analysis**: Full support for `.ang` and related EBSD data formats.
- **Grain Size Distribution**: Calculates D10, D50, and D90 metrics using both frequency and area-weighted distributions.
- **Phase Segmentation**: High-precision phase volume fraction analysis with pre-smoothing pipelines.
- **Boundary Detection**: Standardized Sigma-2 and other coincidence site lattice (CSL) boundary detection.
- **Morphological Analysis**: Robust grain morphological analysis with automated edge exclusion.
- **High-Resolution Visualization**: Generates 300 DPI publication-quality visualizations, including Z-orientation distribution graphs.
- **Portable & User-Friendly**: 
  - One-click execution via `START_HERE.bat`.
  - Automated environment setup (auto-downloads Node.js and Python if missing).
  - Web-based interactive dashboard (Vite + React + TypeScript).

## 🛠 Tech Stack

- **Frontend**: React, TypeScript, Vite, TailwindCSS (Modern, interactive dashboard)
- **Backend/Scripts**: Python (NumPy, SciPy, Matplotlib, OpenCV)
- **Deployment**: Portable batch-based launcher for Windows environments.

## 📦 Getting Started

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/your-username/AutoCalculator.git
    cd AutoCalculator
    ```
2.  **Run the application**:
    - Simply double-click `START_HERE.bat`.
    - The launcher will automatically detect your environment, install necessary dependencies (Node.js, Python), and start the application.

## 📊 Documentation

- For detailed analysis methodology, refer to the documentation in the `참고논문` (Reference Papers) directory.
- Example files for testing can be found in `예시파일`.

## 📄 License

[Insert License Type - e.g., MIT]

---
*Developed for advanced microstructure quantification and visualization.*
