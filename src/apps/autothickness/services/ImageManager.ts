import * as UTIF from 'utif2';

export class ImageManager {
    image: HTMLImageElement | null = null;
    canvas: HTMLCanvasElement | null = null;
    ctx: CanvasRenderingContext2D | null = null;
    scale: number = 1;
    baseScale: number = 1; // fitToCanvas scale = 100% reference
    offsetX: number = 0;
    offsetY: number = 0;
    minScale: number = 0.1;
    maxScale: number = 20;
    brightness: number = 100;
    contrast: number = 100;

    currentChannel: string = 'sem';
    overlayChannel: string | null = null;
    overlayOpacity: number = 0.5;
    channelImages: Record<string, HTMLImageElement> = {};

    private cachedImageData: ImageData | null = null;
    private cachedCanvas: HTMLCanvasElement | null = null;
    private overlayCanvas: HTMLCanvasElement | null = null;

    constructor() { }

    zoomIn() {
        if (!this.canvas) return;
        this.zoom(-1, this.canvas.width / 2, this.canvas.height / 2);
    }

    zoomOut() {
        if (!this.canvas) return;
        this.zoom(1, this.canvas.width / 2, this.canvas.height / 2);
    }

    setScale(newScale: number) {
        if (!this.canvas || !this.image) return;
        const oldScale = this.scale;
        this.scale = newScale;

        // Keep center
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const imgX = (centerX - this.offsetX) / oldScale;
        const imgY = (centerY - this.offsetY) / oldScale;

        this.offsetX = centerX - imgX * this.scale;
        this.offsetY = centerY - imgY * this.scale;
    }

    setCanvas(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /** Check if a file is a TIF/TIFF based on extension */
    private isTifFile(file: File): boolean {
        const name = file.name.toLowerCase();
        return name.endsWith('.tif') || name.endsWith('.tiff');
    }

    /** Check if a file is an ANG based on extension */
    private isAngFile(file: File): boolean {
        const name = file.name.toLowerCase();
        return name.endsWith('.ang') || name.endsWith('.osc');
    }

    /** Decode a TIF/TIFF file and return a data URL (PNG) */
    private async decodeTifToDataURL(file: File): Promise<string> {
        const arrayBuffer = await file.arrayBuffer();
        const ifds = UTIF.decode(arrayBuffer);
        if (ifds.length === 0) throw new Error('No pages found in TIF file');

        const firstPage = ifds[0];
        UTIF.decodeImage(arrayBuffer, firstPage);
        const rgba = UTIF.toRGBA8(firstPage);

        const width = firstPage.width;
        const height = firstPage.height;

        // Draw decoded RGBA data onto a temporary canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) throw new Error('Failed to create canvas context for TIF decoding');

        const imgData = tempCtx.createImageData(width, height);
        imgData.data.set(new Uint8ClampedArray(rgba.buffer));
        tempCtx.putImageData(imgData, 0, 0);

        return tempCanvas.toDataURL('image/png');
    }

    loadImage(file: File): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                // Standard Image or TIF
                let dataUrl: string;
                if (this.isTifFile(file)) {
                    dataUrl = await this.decodeTifToDataURL(file);
                } else {
                    dataUrl = await new Promise<string>((res, rej) => {
                        const reader = new FileReader();
                        reader.onload = (e) => res(e.target?.result as string);
                        reader.onerror = rej;
                        reader.readAsDataURL(file);
                    });
                }

                const img = new Image();
                img.onload = () => {
                    this.image = img;
                    this.channelImages = {};

                    if (img.width > 0 && img.height > 0) {
                        this.cachedCanvas = document.createElement('canvas');
                        this.cachedCanvas.width = img.width;
                        this.cachedCanvas.height = img.height;
                        const ctx = this.cachedCanvas.getContext('2d', { willReadFrequently: true });
                        if (ctx) {
                            ctx.drawImage(img, 0, 0);
                            this.cachedImageData = ctx.getImageData(0, 0, img.width, img.height);
                        }
                    }

                    this.fitToCanvas();
                    resolve();
                };
                img.onerror = () => reject(new Error("Failed to load image source."));
                img.src = dataUrl;
            } catch (err) {
                reject(err);
            }
        });
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = parent.clientHeight;
        }
    }

    fitToCanvas() {
        if (!this.canvas || !this.image) return;

        // Ensure canvas has valid dimensions
        if (this.canvas.width < 10 || this.canvas.height < 10) {
            this.scale = 1.0;
            this.offsetX = 0;
            this.offsetY = 0;
            return;
        }

        const canvasRatio = this.canvas.width / this.canvas.height;
        const imageRatio = this.image.width / this.image.height;

        if (imageRatio > canvasRatio) {
            this.scale = this.canvas.width / this.image.width;
        } else {
            this.scale = this.canvas.height / this.image.height;
        }

        // If for some reason scale is extremely small, default to 1.0
        if (this.scale < 0.01) this.scale = 1.0;

        // Store as base scale (this = 100% for display)
        this.baseScale = this.scale;

        // Center
        this.offsetX = (this.canvas.width - this.image.width * this.scale) / 2;
        this.offsetY = (this.canvas.height - this.image.height * this.scale) / 2;
    }

    /** Returns the zoom percentage relative to fitToCanvas (100% = fit to screen) */
    getDisplayZoom(): number {
        if (this.baseScale === 0) return 100;
        return Math.round((this.scale / this.baseScale) * 100);
    }

    zoom(delta: number, mouseX: number, mouseY: number) {
        if (!this.image || !this.canvas) return;

        const zoomFactor = delta > 0 ? 0.9 : 1.1;
        const newScale = this.scale * zoomFactor;

        // Clamp zoom
        if (newScale < this.minScale || newScale > this.maxScale) return;

        // Mouse position relative to canvas (passed as mouseX, mouseY)
        // Convert to image coordinates before zoom
        const imgX = (mouseX - this.offsetX) / this.scale;
        const imgY = (mouseY - this.offsetY) / this.scale;

        this.scale = newScale;

        // Calculate new offset to keep the point under mouse stable
        this.offsetX = mouseX - imgX * this.scale;
        this.offsetY = mouseY - imgY * this.scale;
    }

    pan(dx: number, dy: number) {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    setAdjustments(brightness: number, contrast: number) {
        this.brightness = brightness;
        this.contrast = contrast;
    }

    setChannel(channel: string) {
        if (this.channelImages[channel]) {
            this.currentChannel = channel;
            this.image = this.channelImages[channel];

            // Update cache
            if (this.image && this.cachedCanvas) {
                const ctx = this.cachedCanvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(this.image, 0, 0);
                    this.cachedImageData = ctx.getImageData(0, 0, this.image.width, this.image.height);
                }
            }
        }
    }

    setOverlay(channel: string | null, opacity: number = 0.5) {
        this.overlayChannel = channel;
        this.overlayOpacity = opacity;
    }

    draw() {
        if (!this.canvas || !this.ctx || !this.image) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();

        // Apply brightness and contrast only if changed (Performance)
        if (this.brightness !== 100 || this.contrast !== 100) {
            this.ctx.filter = `brightness(${this.brightness}%) contrast(${this.contrast}%)`;
        }

        this.ctx.imageSmoothingEnabled = this.scale < 1.0;

        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // Draw base image
        this.ctx.drawImage(this.image, 0, 0);

        // Draw overlay if set
        if (this.overlayChannel && this.channelImages[this.overlayChannel]) {
            this.ctx.save();
            this.ctx.globalAlpha = this.overlayOpacity;
            this.ctx.drawImage(this.channelImages[this.overlayChannel], 0, 0);
            this.ctx.restore();
        }

        this.ctx.restore();
    }

    // Coordinate conversion
    screenToImage(sx: number, sy: number) {
        return {
            x: (sx - this.offsetX) / this.scale,
            y: (sy - this.offsetY) / this.scale
        };
    }

    imageToScreen(ix: number, iy: number) {
        return {
            x: ix * this.scale + this.offsetX,
            y: iy * this.scale + this.offsetY
        };
    }

    getImageData(): ImageData | null {
        return this.cachedImageData;
    }

    getData(x: number, y: number, w: number, h: number): ImageData | null {
        if (!this.cachedCanvas) return null;
        const ctx = this.cachedCanvas.getContext('2d');
        if (!ctx) return null;
        // Use the existing cached canvas to get ROI data
        return ctx.getImageData(x, y, w, h);
    }

    getViewport() {
        if (!this.canvas || !this.image) return { x: 0, y: 0, width: 0, height: 0 };
        return {
            x: -this.offsetX / this.scale,
            y: -this.offsetY / this.scale,
            width: this.canvas.width / this.scale,
            height: this.canvas.height / this.scale
        };
    }

    drawTo(targetCtx: CanvasRenderingContext2D) {
        if (!this.image) return;
        targetCtx.drawImage(this.image, this.offsetX, this.offsetY, this.image.width * this.scale, this.image.height * this.scale);
    }
}
