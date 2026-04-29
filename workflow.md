# Development & Deployment Workflow

This document outlines the essential steps for updating and deploying the Microstructure Analyzer Suite.

## 1. Feature Development
- All new features should be implemented in the `src/apps` directory.
- Use `npm run dev` to verify changes locally before pushing.
- Ensure that UI elements follow the premium design guidelines (dark mode, glassmorphism, smooth animations).

## 2. Testing and Validation
- **Critical:** Before pushing any changes, verify that the application launches correctly via `START_HERE.bat`.
- Test the data processing logic with various file formats (.asc, .txt, .xrdml).
- Verify that "Overlap Mode" works correctly without performance degradation.

## 3. GitHub Push & Update Integrity
- **Mandatory Requirement:** The update system must remain functional. When pushing to GitHub, ensure that the `version.txt` and the released binaries/source code on GitHub do not cause errors in the auto-update process.
- **Auto-Update Safety:** Never delete or rename files that the `START_HERE.bat` or the internal updater depends on unless you update the updater logic simultaneously.
- **Release Verification:** After pushing, verify that a fresh download/update from GitHub results in a working application.

## 4. version.txt
- When a stable version is reached, increment the version in `version.txt` to notify users of an available update.
