export interface CalibrationPreset {
    pixelsPerUnit: number;
    unit: string;
    notes: string;
}

export class CalibrationManager {
    pixelsPerUnit: number | null;
    unit: string;
    imageName: string | null;
    notes: string;
    calibrationDate: string;

    constructor() {
        // Factory Default: 청주신규 1600
        this.pixelsPerUnit = 35.75883576;
        this.unit = 'µm';
        this.imageName = null;
        this.notes = '청주신규 1600 (기본값)';
        this.calibrationDate = new Date().toISOString();
    }

    setCalibration(pixelLength: number, realLength: number, unit: string, notes: string = '', imageName: string = '') {
        this.pixelsPerUnit = pixelLength / realLength;
        this.unit = unit;
        this.notes = notes;
        this.imageName = imageName;
        this.calibrationDate = new Date().toISOString();
    }

    resetDefault() {
        localStorage.removeItem('defaultCalibration');
        // Restore factory default
        this.pixelsPerUnit = 35.75883576;
        this.unit = 'µm';
        this.notes = '청주신규 1600 (기본값)';
        this.calibrationDate = new Date().toISOString();
        return true;
    }

    saveDefault() {
        if (!this.isCalibrated()) return false;
        const defaultData = {
            pixelsPerUnit: this.pixelsPerUnit,
            unit: this.unit,
            notes: this.notes
        };
        localStorage.setItem('defaultCalibration', JSON.stringify(defaultData));
        return true;
    }

    loadDefault() {
        const dataStr = localStorage.getItem('defaultCalibration');
        if (dataStr) {
            try {
                const data = JSON.parse(dataStr);
                this.pixelsPerUnit = data.pixelsPerUnit;
                this.unit = data.unit;
                this.notes = data.notes + ' (기본값)';
                this.calibrationDate = new Date().toISOString();
                return true;
            } catch (e) {
                console.error('Failed to load default calibration', e);
            }
        }
        return false;
    }

    // --- Preset Management ---
    getPresets(): Record<string, CalibrationPreset> {
        try {
            const presetsStr = localStorage.getItem('calibrationPresets');
            return presetsStr ? JSON.parse(presetsStr) : {};
        } catch (e) {
            console.error("Failed to parse presets", e);
            return {};
        }
    }

    savePreset(name: string) {
        if (!this.isCalibrated() || !this.pixelsPerUnit) return false;
        const presets = this.getPresets();
        presets[name] = {
            pixelsPerUnit: this.pixelsPerUnit,
            unit: this.unit,
            notes: this.notes
        };
        localStorage.setItem('calibrationPresets', JSON.stringify(presets));
        return true;
    }

    loadPreset(name: string) {
        const presets = this.getPresets();
        const data = presets[name];
        if (data) {
            this.pixelsPerUnit = data.pixelsPerUnit;
            this.unit = data.unit;
            this.notes = name;
            this.calibrationDate = new Date().toISOString();
            return true;
        }
        return false;
    }

    deletePreset(name: string) {
        const presets = this.getPresets();
        if (presets[name]) {
            delete presets[name];
            localStorage.setItem('calibrationPresets', JSON.stringify(presets));
            return true;
        }
        return false;
    }

    initDefaultPresets() {
        let presets: Record<string, CalibrationPreset> = {};
        try {
            const stored = localStorage.getItem('calibrationPresets');
            if (stored) {
                presets = JSON.parse(stored);
            }
        } catch (e) {
            console.error("Failed to parse presets", e);
        }

        const defaultPresets: Record<string, CalibrationPreset> = {
            "청주신규 1600x": { pixelsPerUnit: 35.75883576, unit: "µm", notes: "기본 제공 프리셋" },
            "청주신규 800x": { pixelsPerUnit: 18.08731809, unit: "µm", notes: "기본 제공 프리셋" },
            "청주신규 320x": { pixelsPerUnit: 7.276507277, unit: "µm", notes: "기본 제공 프리셋" }
        };

        let updated = false;
        for (const [key, value] of Object.entries(defaultPresets)) {
            if (!presets[key]) {
                presets[key] = value;
                updated = true;
            }
        }

        if (updated || !localStorage.getItem('calibrationPresets')) {
            localStorage.setItem('calibrationPresets', JSON.stringify(presets));
            console.log("Updated default calibration presets.");
        }
    }

    isCalibrated() {
        return this.pixelsPerUnit !== null;
    }

    pixelsToReal(pixels: number) {
        if (!this.isCalibrated() || !this.pixelsPerUnit) return null;
        return pixels / this.pixelsPerUnit;
    }

    realToPixels(real: number) {
        if (!this.isCalibrated() || !this.pixelsPerUnit) return null;
        return real * this.pixelsPerUnit;
    }

    formatMeasurement(pixels: number) {
        if (!this.isCalibrated()) {
            return `${pixels.toFixed(2)} px`;
        }
        const real = this.pixelsToReal(pixels);
        return real !== null ? `${real.toFixed(2)} ${this.unit}` : `${pixels.toFixed(2)} px`;
    }

    saveToFile() {
        const data = {
            pixelsPerUnit: this.pixelsPerUnit,
            unit: this.unit,
            imageName: this.imageName,
            notes: this.notes,
            calibrationDate: this.calibrationDate
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calibration_${Date.now()}.cal`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async loadFromFile(file: File) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const buffer = e.target?.result as ArrayBuffer;
                    let content = new TextDecoder('utf-8').decode(buffer);

                    if (content.includes('') || content.includes('ï¿½')) {
                        content = new TextDecoder('euc-kr').decode(buffer);
                    }

                    if (content.trim().startsWith('{')) {
                        const data = JSON.parse(content);
                        this.pixelsPerUnit = data.pixelsPerUnit;
                        this.unit = data.unit;
                        this.imageName = data.imageName;
                        this.notes = data.notes;
                        this.calibrationDate = data.calibrationDate;
                        resolve(data);
                    } else {
                        const lines = content.split('\n');
                        let currentSection: any = null;
                        const calibrations: any[] = [];

                        for (let line of lines) {
                            line = line.trim();

                            if (line.match(/^\[SPATIAL\d+\]$/)) {
                                if (currentSection) {
                                    calibrations.push(currentSection);
                                }
                                currentSection = {};
                            } else if (currentSection && (line.includes('=') || line.includes(','))) {
                                let key, value;
                                if (line.includes('=')) {
                                    [key, value] = line.split('=').map(s => s.trim());
                                } else {
                                    const parts = line.split(',');
                                    if (parts.length > 0 && !isNaN(parseFloat(parts[1]))) {
                                        key = 'SystemCal';
                                        value = parts[1];
                                    } else if (!isNaN(parseFloat(parts[0]))) {
                                        key = 'SystemCal';
                                        value = parts[0];
                                    }
                                }

                                if (key && value) {
                                    currentSection[key] = value;
                                }
                            }
                        }

                        if (currentSection) {
                            calibrations.push(currentSection);
                        }

                        if (calibrations.length > 0) {
                            resolve({
                                calibrations: calibrations,
                                filename: file.name,
                                needsSelection: calibrations.length > 1
                            });
                        } else {
                            reject(new Error('No calibration sections found'));
                        }
                    }
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    applyCalibrationData(cal: any, filename: string) {
        let pixPerUnit = cal.PixPerUnit ? cal.PixPerUnit.split(',')[0] : null;

        if (!pixPerUnit && cal.SystemCal) {
            pixPerUnit = cal.SystemCal.split(',')[0];
        }

        if (pixPerUnit) {
            this.pixelsPerUnit = parseFloat(pixPerUnit);
            this.unit = cal.UnitName || 'µm';
            this.imageName = filename;
            this.notes = cal.CalibName || '';
            this.calibrationDate = new Date().toISOString();
            return true;
        }
        return false;
    }
}
