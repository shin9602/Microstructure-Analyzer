import { Chart, type ChartConfiguration, type ChartTypeRegistry, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components
Chart.register(...registerables, annotationPlugin);

export class ProfileChartManager {
    chart: Chart | null = null;
    canvasId: string;
    onHoverCallback: ((index: number | null) => void) | null;
    onClickCallback: ((value: number) => void) | null;
    currentProfileData: any[] = [];

    constructor(canvasId: string, onHoverCallback: ((index: number | null) => void) | null = null, onClickCallback: ((value: number) => void) | null = null) {
        this.canvasId = canvasId;
        this.onHoverCallback = onHoverCallback;
        this.onClickCallback = onClickCallback;
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    clear() {
        if (this.chart) {
            this.chart.data.labels = [];
            this.chart.data.datasets = [];
            this.chart.update();
        }
    }

    update(profileData: any[], unit: string, boundaries: number[] = [], labels: string[] = [], autoScaleY: boolean = false, extraSeries: number[][] = [], showRGB: boolean = true, ciHistogram?: number[]) {
        const canvas = document.getElementById(this.canvasId) as HTMLCanvasElement;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Store profile data for hover lookups
        this.currentProfileData = profileData;

        let config: ChartConfiguration;

        // --- HISTOGRAM MODE ---
        if (unit === 'Level' || unit === 'Brightness') {
            const xLabels = profileData.map(p => p.distance); // 0..255
            const counts = profileData.map(p => p.value);

            const annotations: any = {};
            if (boundaries.length > 0) {
                boundaries.forEach((threshold, i) => {
                    const label = labels[i] || 'Threshold';
                    const isSelected = label === 'Selected';
                    const isT1 = label === 'T1' || label.includes('T1');
                    const isT2 = label === 'T2' || label.includes('T2');
                    const isCI = label.includes('CI');

                    let color = '#f43f5e'; // Rose/Red default
                    if (isT1) color = '#2563eb'; // Blue
                    else if (isT2) color = '#16a34a'; // Green
                    else if (isCI) color = '#8b5cf6'; // Purple for CI
                    else if (label.includes('Otsu')) color = '#94a3b8'; // Slate for hints

                    annotations[`threshold_${i}`] = {
                        type: 'line',
                        scaleID: 'x',
                        value: threshold,
                        borderColor: color,
                        borderWidth: isSelected ? 3 : 2,
                        borderDash: isSelected ? [] : [4, 4],
                        label: {
                            content: label,
                            display: true,
                            position: 'start',
                            yAdjust: isT1 ? 15 : (isT2 ? 35 : (isCI ? 55 : 10)), // Positive values move label DOWN from the top start
                            backgroundColor: color,
                            color: '#fff',
                            padding: 3,
                            borderRadius: 4,
                            font: { size: 10, weight: (isSelected || isT1 || isT2 || isCI) ? 'bold' : 'normal' }
                        }
                    };
                });
            }

            // Construct Datasets (Histogram + GMM Curves)
            const datasets: any[] = [{
                type: 'bar',
                label: 'Histogram',
                data: counts,
                backgroundColor: '#e2e8f0', // Very light slate for background
                barPercentage: 1.0,
                categoryPercentage: 1.0,
                order: 2
            }];

            if (extraSeries && extraSeries.length > 0) {
                const colors = ['#475569', '#d97706', '#2563eb']; // Slate(Co), Amber(MC), Blue(WC)
                const names = ['Co (Matrix)', 'MC (Mixed)', 'WC (Grain)'];

                extraSeries.forEach((curve, idx) => {
                    datasets.push({
                        type: 'line',
                        label: names[idx] || `Phase ${idx}`,
                        data: curve,
                        borderColor: colors[idx % colors.length],
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 1
                    });
                });
            }

            if (ciHistogram && ciHistogram.length > 0) {
                datasets.push({
                    type: 'line',
                    label: 'CI Distribution',
                    data: ciHistogram,
                    borderColor: '#8b5cf6', // Purple
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.2,
                    order: 0 // Draw on top
                });
            }

            config = {
                type: 'bar', // Mixed chart base
                data: {
                    labels: xLabels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: 'index', intersect: false },
                    layout: {
                        padding: {
                            top: 40, // Room for threshold labels
                            right: 30, // Room for 255 indicator
                            left: 5,
                            bottom: 5
                        }
                    },
                    plugins: {
                        legend: {
                            display: extraSeries && extraSeries.length > 0, // Show legend only if GMM curves exist
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                padding: 15,
                                font: { size: 10 }
                            }
                        },
                        tooltip: { enabled: true },
                        annotation: { annotations }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Brightness (0-255)', font: { size: 11, weight: 'bold' } },
                            ticks: {
                                maxRotation: 0,
                                autoSkip: false,
                                callback: function (val: any) {
                                    const num = Number(this.getLabelForValue(val as number));
                                    // Show 0, 50, 100, ... and 255
                                    if (num === 0 || num === 255 || num % 50 === 0) return num;
                                    return null;
                                },
                                font: { size: 11 }
                            },
                            grid: { display: false }
                        },
                        y: {
                            title: { display: true, text: 'Pixel Count', font: { size: 11, weight: 'bold' } },
                            beginAtZero: true
                        }
                    }
                }
            };

        } else {
            // --- ORIGINAL PROFILE MODE ---
            const distances = profileData.map(p => p.distance.toFixed(2));
            const intensities = profileData.map(p => p.value);

            const datasets: any[] = [
                {
                    label: 'Intensity',
                    data: intensities,
                    borderColor: '#0f172a',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y',
                    order: 1
                }
            ];

            if (showRGB) {
                const r = profileData.map(p => p.r);
                const g = profileData.map(p => p.g);
                const b = profileData.map(p => p.b);
                const diff = profileData.map(p => p.r - p.b);

                datasets.push(
                    {
                        label: 'Red',
                        data: r,
                        borderColor: 'rgba(239, 68, 68, 0.8)',
                        borderWidth: 1,
                        pointRadius: 0,
                        hidden: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Green',
                        data: g,
                        borderColor: 'rgba(34, 197, 94, 0.8)',
                        borderWidth: 1,
                        pointRadius: 0,
                        hidden: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Blue',
                        data: b,
                        borderColor: 'rgba(59, 130, 246, 0.8)',
                        borderWidth: 1,
                        pointRadius: 0,
                        hidden: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'R-B Diff',
                        data: diff,
                        borderColor: '#8b5cf6',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        borderDash: [5, 5],
                        yAxisID: 'y1',
                        hidden: false
                    }
                );
            }

            config = {
                type: 'line',
                data: {
                    labels: distances,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        title: { display: false },
                        legend: {
                            position: 'top',
                            labels: { color: '#475569', font: { size: 10 } }
                        },
                        tooltip: {
                            enabled: true,
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            titleColor: '#0f172a',
                            bodyColor: '#334155',
                            borderColor: '#cbd5e1',
                            borderWidth: 1,
                            displayColors: true,
                        },
                        annotation: {
                            annotations: {}
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: `Distance (${unit})`, color: '#64748b' },
                            grid: { color: '#e2e8f0' },
                            ticks: { color: '#64748b', maxTicksLimit: 10 }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: { display: true, text: 'Intensity (0-255)', color: '#64748b' },
                            grid: { color: '#e2e8f0' },
                            ticks: { color: '#64748b' },
                            ...(autoScaleY ? {
                                min: Math.max(0, Math.min(...intensities) - 5),
                                max: Math.min(255, Math.max(...intensities) + 5)
                            } : {
                                min: 0,
                                max: 255
                            })
                        },
                        ...(showRGB ? {
                            y1: {
                                type: 'linear',
                                display: true,
                                position: 'right',
                                title: { display: true, text: 'Diff', color: '#64748b' },
                                grid: { drawOnChartArea: false },
                                ticks: { color: '#64748b' },
                            }
                        } : {})
                    },
                    onHover: (event, elements) => {
                        if (elements && elements.length > 0) {
                            const index = elements[0].index;
                            if (this.onHoverCallback) this.onHoverCallback(index);
                        } else {
                            if (this.onHoverCallback) this.onHoverCallback(null);
                        }
                    }
                }
            };

            // Add boundary annotations if provided
            if (boundaries.length > 0 && config.options && config.options.plugins && config.options.plugins.annotation) {
                const annotations: any = {};
                boundaries.forEach((boundaryIndex, i) => {
                    const safeIndex = Math.min(Math.floor(boundaryIndex), profileData.length - 1);
                    if (safeIndex < 0) return;
                    const xValue = distances[safeIndex];
                    annotations[`line${i}`] = {
                        type: 'line',
                        xMin: xValue,
                        xMax: xValue,
                        borderColor: '#ef4444',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        label: {
                            display: labels[i] ? true : false,
                            content: labels[i] || '',
                            position: 'start',
                            backgroundColor: 'rgba(0,0,0,0.7)',
                            color: '#fff',
                            font: { size: 10 }
                        }
                    };
                });
                config.options.plugins.annotation.annotations = annotations;
            }
        }

        if (this.chart) {
            this.chart.destroy();
        }
        this.chart = new Chart(ctx, config);
    }
}
