export class GaussianSmoothing {
    static gaussianKernel(sigma: number, size: number) {
        const kernel = [];
        const center = (size - 1) / 2;
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - center;
            const value = Math.exp(-(x * x) / (2 * sigma * sigma)) / (Math.sqrt(2 * Math.PI) * sigma);
            kernel.push(value);
            sum += value;
        }
        return kernel.map(v => v / sum);
    }

    static smooth(data: number[], sigma: number = 1, size: number = 5) {
        const kernel = this.gaussianKernel(sigma, size);
        const center = (size - 1) / 2;
        const result = new Array(data.length).fill(0);

        for (let i = 0; i < data.length; i++) {
            let sum = 0;
            for (let k = 0; k < size; k++) {
                const idx = i + k - center;
                if (idx >= 0 && idx < data.length) {
                    sum += data[idx] * kernel[k];
                } else {
                    const clampedIdx = Math.max(0, Math.min(data.length - 1, idx));
                    sum += data[clampedIdx] * kernel[k];
                }
            }
            result[i] = sum;
        }
        return result;
    }
}

export class ZeroCrossingDetector {
    static detect(values: number[], threshold: number = 1.0) {
        const crossings = [];
        const firstDeriv = [];
        const secondDeriv = [];

        for (let i = 0; i < values.length; i++) {
            const prev = values[Math.max(0, i - 1)];
            const next = values[Math.min(values.length - 1, i + 1)];
            const curr = values[i];

            firstDeriv.push((next - prev) / 2);
            secondDeriv.push(next - 2 * curr + prev);
        }

        for (let i = 1; i < secondDeriv.length - 1; i++) {
            const y1 = secondDeriv[i];
            const y2 = secondDeriv[i + 1];

            if (y1 * y2 < 0) {
                const zeroPos = i + Math.abs(y1) / (Math.abs(y1) + Math.abs(y2));

                // Average slope around zero crossing
                const slope = (Math.abs(firstDeriv[i]) + Math.abs(firstDeriv[i + 1])) / 2;
                if (slope > threshold) {
                    crossings.push({ index: zeroPos, strength: slope });
                }
            }
        }
        return crossings;
    }
}

export class ColorHelper {
    static rgbToLab(r: number, g: number, b: number) {
        let r_ = r / 255, g_ = g / 255, b_ = b / 255;
        r_ = r_ > 0.04045 ? Math.pow((r_ + 0.055) / 1.055, 2.4) : r_ / 12.92;
        g_ = g_ > 0.04045 ? Math.pow((g_ + 0.055) / 1.055, 2.4) : g_ / 12.92;
        b_ = b_ > 0.04045 ? Math.pow((b_ + 0.055) / 1.055, 2.4) : b_ / 12.92;

        let x = (r_ * 0.4124 + g_ * 0.3576 + b_ * 0.1805) * 100;
        let y = (r_ * 0.2126 + g_ * 0.7152 + b_ * 0.0722) * 100;
        let z = (r_ * 0.0193 + g_ * 0.1192 + b_ * 0.9505) * 100;

        x /= 95.047; y /= 100.000; z /= 108.883;
        x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
        y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
        z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;

        return {
            l: (116 * y) - 16,
            a: 500 * (x - y),
            b: 200 * (y - z)
        };
    }

    static rgbToHsv(r: number, g: number, b: number) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s, v = max;
        const d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) h = 0;
        else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: h * 360, s: s * 100, v: v * 100 };
    }
}

export class EdgeDetector {
    static cannyEdgeDetection(imageData: ImageData, lowThreshold = 50, highThreshold = 100) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        // Convert to grayscale
        const gray = new Uint8ClampedArray(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const idx = i / 4;
            gray[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        // Gaussian blur (simplified)
        const blurred = this.gaussianBlur(gray, width, height);

        // Sobel edge detection
        const edges = this.sobelEdgeDetection(blurred, width, height);

        // Threshold
        const result = new Uint8ClampedArray(width * height);
        for (let i = 0; i < edges.length; i++) {
            result[i] = edges[i] > highThreshold ? 255 : 0;
        }

        return result;
    }

    static gaussianBlur(data: Uint8ClampedArray, width: number, height: number) {
        const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        const kernelSum = 16;
        const result = new Uint8ClampedArray(data.length);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let sum = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = (y + ky) * width + (x + kx);
                        const kernelIdx = (ky + 1) * 3 + (kx + 1);
                        sum += data[idx] * kernel[kernelIdx];
                    }
                }
                result[y * width + x] = sum / kernelSum;
            }
        }

        return result;
    }

    static sobelEdgeDetection(data: Uint8ClampedArray, width: number, height: number) {
        const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
        const result = new Uint8ClampedArray(data.length);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0, gy = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const idx = (y + ky) * width + (x + kx);
                        const kernelIdx = (ky + 1) * 3 + (kx + 1);
                        gx += data[idx] * sobelX[kernelIdx];
                        gy += data[idx] * sobelY[kernelIdx];
                    }
                }
                result[y * width + x] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        return result;
    }

    static findHorizontalEdges(edgeData: Uint8ClampedArray, width: number, height: number, minLength = 100) {
        const edges = [];

        for (let y = 0; y < height; y++) {
            let startX = -1;
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (edgeData[idx] > 127) {
                    if (startX === -1) startX = x;
                } else {
                    if (startX !== -1 && x - startX >= minLength) {
                        edges.push({
                            x1: startX,
                            y1: y,
                            x2: x - 1,
                            y2: y
                        });
                    }
                    startX = -1;
                }
            }
            if (startX !== -1 && width - startX >= minLength) {
                edges.push({
                    x1: startX,
                    y1: y,
                    x2: width - 1,
                    y2: y
                });
            }
        }

        return edges;
    }
}

export class ColorSegmentation {
    static findSimilarColorRegion(imageData: ImageData, clickX: number, clickY: number, tolerance = 30) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        // Get reference color
        const refIdx = (clickY * width + clickX) * 4;
        const refR = data[refIdx];
        const refG = data[refIdx + 1];
        const refB = data[refIdx + 2];

        // Flood fill to find similar pixels
        const visited = new Uint8Array(width * height);
        const queue = [{ x: clickX, y: clickY }];
        visited[clickY * width + clickX] = 1;

        let minX = clickX, maxX = clickX, minY = clickY, maxY = clickY;

        while (queue.length > 0) {
            const { x, y } = queue.shift()!;

            // Update bounding box
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);

            // Check neighbors
            const neighbors = [
                { x: x - 1, y },
                { x: x + 1, y },
                { x, y: y - 1 },
                { x, y: y + 1 }
            ];

            for (const { x: nx, y: ny } of neighbors) {
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                const idx = ny * width + nx;
                if (visited[idx]) continue;

                const pixelIdx = idx * 4;
                const r = data[pixelIdx];
                const g = data[pixelIdx + 1];
                const b = data[pixelIdx + 2];

                const colorDiff = Math.sqrt(
                    Math.pow(r - refR, 2) +
                    Math.pow(g - refG, 2) +
                    Math.pow(b - refB, 2)
                );

                if (colorDiff <= tolerance) {
                    visited[idx] = 1;
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    static detectAllLayers(imageData: ImageData, minRegionSize = 1000) {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;
        const visited = new Uint8Array(width * height);
        const regions = [];

        // Sample colors across the image
        const samplePoints = [];
        const gridSize = 20;
        for (let y = 0; y < height; y += gridSize) {
            for (let x = 0; x < width; x += gridSize) {
                samplePoints.push({ x, y });
            }
        }

        for (const { x, y } of samplePoints) {
            const idx = y * width + x;
            if (visited[idx]) continue;

            const region = this.findSimilarColorRegion(imageData, x, y, 30);
            const regionArea = region.width * region.height;

            if (regionArea >= minRegionSize) {
                // Mark region as visited
                for (let ry = region.y; ry < region.y + region.height; ry++) {
                    for (let rx = region.x; rx < region.x + region.width; rx++) {
                        if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
                            visited[ry * width + rx] = 1;
                        }
                    }
                }

                regions.push(region);
            }
        }

        return regions;
    }
}
