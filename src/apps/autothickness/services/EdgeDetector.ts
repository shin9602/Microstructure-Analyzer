/**
 * EdgeDetector - Canny Edge Detection
 * Ported from AutoThickness_v1.0.0/app.js EdgeDetector class
 */

export class EdgeDetector {
    static cannyEdgeDetection(imageData: ImageData, lowThreshold: number = 50, highThreshold: number = 100): Uint8ClampedArray {
        const width = imageData.width;
        const height = imageData.height;
        const data = imageData.data;

        // Convert to grayscale
        const gray = new Uint8ClampedArray(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const idx = i / 4;
            gray[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        const blurred = this.gaussianBlur(gray, width, height);
        const edges = this.sobelEdgeDetection(blurred, width, height);

        const result = new Uint8ClampedArray(width * height);
        for (let i = 0; i < edges.length; i++) {
            result[i] = edges[i] > highThreshold ? 255 : 0;
        }

        return result;
    }

    static gaussianBlur(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
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

    static sobelEdgeDetection(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
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
}
