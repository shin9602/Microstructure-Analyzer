export class ColorClusterer {
    k: number;
    centroids: number[][];
    labels: string[];

    constructor(k: number = 4) {
        this.k = k;
        this.centroids = [];
        this.labels = ['배경', '검은색 층', '노란색 층', '하단 조직'];
    }

    // Simple K-means implementation
    train(pixels: number[][], maxIterations: number = 20) {
        if (pixels.length === 0) return;

        // Initialize centroids randomly from pixels
        this.centroids = [];
        for (let i = 0; i < this.k; i++) {
            const randomIdx = Math.floor(Math.random() * pixels.length);
            this.centroids.push([...pixels[randomIdx]]);
        }

        for (let iter = 0; iter < maxIterations; iter++) {
            const clusters: number[][][] = Array.from({ length: this.k }, () => []);

            // Assignment step
            for (const pixel of pixels) {
                let minDist = Infinity;
                let clusterIdx = 0;
                for (let i = 0; i < this.k; i++) {
                    const d = this.distSq(pixel, this.centroids[i]);
                    if (d < minDist) {
                        minDist = d;
                        clusterIdx = i;
                    }
                }
                clusters[clusterIdx].push(pixel);
            }

            // Update step
            let changed = false;
            for (let i = 0; i < this.k; i++) {
                if (clusters[i].length === 0) continue;
                const newCentroid = [0, 0, 0];
                for (const p of clusters[i]) {
                    newCentroid[0] += p[0];
                    newCentroid[1] += p[1];
                    newCentroid[2] += p[2];
                }
                newCentroid[0] /= clusters[i].length;
                newCentroid[1] /= clusters[i].length;
                newCentroid[2] /= clusters[i].length;

                if (this.distSq(newCentroid, this.centroids[i]) > 1) {
                    this.centroids[i] = newCentroid;
                    changed = true;
                }
            }

            if (!changed) break;
        }

        // Sort centroids by brightness to assign initial labels (heuristically)
        // Background usually brightest, layers in middle, etc.
        // But the user will define ROI specifically, so we might just sort by Y or brightness
        this.centroids.sort((a, b) => (b[0] + b[1] + b[2]) - (a[0] + a[1] + a[2]));
    }

    predict(pixel: number[]) {
        let minDist = Infinity;
        let clusterIdx = 0;
        for (let i = 0; i < this.centroids.length; i++) {
            const d = this.distSq(pixel, this.centroids[i]);
            if (d < minDist) {
                minDist = d;
                clusterIdx = i;
            }
        }
        return clusterIdx;
    }

    distSq(p1: number[], p2: number[]) {
        return Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2) + Math.pow(p1[2] - p2[2], 2);
    }
}
