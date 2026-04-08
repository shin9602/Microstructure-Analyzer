import React, { useState, Suspense, lazy } from 'react';
import { Microscope, Ruler, FileText, ArrowRight, Loader2 } from 'lucide-react';

// Lazy load apps to reduce initial bundle size
const MicrostructureApp = lazy(() => import('./apps/microstructure/App'));
const AutoThicknessApp = lazy(() => import('./apps/autothickness/App'));
const EbsdApp = lazy(() => import('./apps/ebsd/App'));

const LoadingFallback = () => (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
        <p className="text-slate-400 animate-pulse">애플리케이션을 불러오는 중...</p>
    </div>
);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-8 text-center">
                    <div className="bg-red-500/20 p-6 rounded-2xl border border-red-500/50 max-w-2xl">
                        <h2 className="text-2xl font-bold text-red-500 mb-4">Application Error</h2>
                        <p className="text-slate-300 mb-6">{this.state.error?.message || 'Unknown error occurred'}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
                        >
                            Reload Application
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const Launcher: React.FC = () => {
    const [app, setApp] = useState<'launcher' | 'microstructure' | 'autothickness' | 'ebsd'>('launcher');

    if (app === 'microstructure') {
        return (
            <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                    <MicrostructureApp onBack={() => setApp('launcher')} />
                </Suspense>
            </ErrorBoundary>
        );
    }

    if (app === 'ebsd') {
        return (
            <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                    <EbsdApp onBack={() => setApp('launcher')} />
                </Suspense>
            </ErrorBoundary>
        );
    }

    if (app === 'autothickness') {
        return (
            <ErrorBoundary>
                <Suspense fallback={<LoadingFallback />}>
                    <AutoThicknessApp onBack={() => setApp('launcher')} />
                </Suspense>
            </ErrorBoundary>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-8 font-sans">
            <div className="max-w-4xl w-full">
                <header className="mb-12 text-center">
                    <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                        Research Tools Suite
                    </h1>
                    <p className="text-slate-400 text-lg">
                        Select an application to launch
                    </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {/* Microstructure Card */}
                    <button
                        onClick={() => setApp('microstructure')}
                        className="group relative bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-blue-500 rounded-2xl p-8 text-left transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1"
                    >
                        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Microscope size={120} />
                        </div>
                        <div className="relative z-10">
                            <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center mb-6 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                                <Microscope size={24} />
                            </div>
                            <h2 className="text-2xl font-bold mb-3 text-white">Microstructure Analyzer</h2>
                            <p className="text-slate-400 mb-6 leading-relaxed">
                                Advanced XRD analysis, grain size calculation (Scherrer), Williamson-Hall plots, and C/N ratio analysis.
                            </p>
                            <div className="flex items-center text-blue-400 font-medium group-hover:translate-x-1 transition-transform">
                                Launch Application <ArrowRight size={16} className="ml-2" />
                            </div>
                        </div>
                    </button>

                    {/* EBSD Card */}
                    <button
                        onClick={() => setApp('ebsd')}
                        className="group relative bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-amber-500 rounded-2xl p-8 text-left transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10 hover:-translate-y-1"
                    >
                        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                            <FileText size={120} />
                        </div>
                        <div className="relative z-10">
                            <div className="w-12 h-12 bg-amber-500/20 rounded-xl flex items-center justify-center mb-6 text-amber-400 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                                <FileText size={24} />
                            </div>
                            <h2 className="text-2xl font-bold mb-3 text-white">EBSD Analysis</h2>
                            <p className="text-slate-400 mb-6 leading-relaxed">
                                미세조직 .ang 파일 단위 자동화 분석: 위상 비율 계산, 그레인 사이즈(WC/Gamma), 형태학 분석을 지원합니다.
                            </p>
                            <div className="flex items-center text-amber-400 font-medium group-hover:translate-x-1 transition-transform">
                                Launch Application <ArrowRight size={16} className="ml-2" />
                            </div>
                        </div>
                    </button>

                    {/* AutoThickness Card */}
                    <button
                        onClick={() => setApp('autothickness')}
                        className="group relative bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-emerald-500 rounded-2xl p-8 text-left transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/10 hover:-translate-y-1"
                    >
                        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Ruler size={120} />
                        </div>
                        <div className="relative z-10">
                            <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center mb-6 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                                <Ruler size={24} />
                            </div>
                            <h2 className="text-2xl font-bold mb-3 text-white">Image Analyzer</h2>
                            <p className="text-slate-400 mb-6 leading-relaxed">
                                OM/SEM 이미지 분석: 코팅 두께 자동측정, 선 분석(조도), 입도 분석 등 통합 이미지 분석 도구.
                            </p>
                            <div className="flex items-center text-emerald-400 font-medium group-hover:translate-x-1 transition-transform">
                                Launch Application <ArrowRight size={16} className="ml-2" />
                            </div>
                        </div>
                    </button>
                </div>

                <footer className="mt-12 text-center text-slate-500 text-sm">
                    v1.0.0 • Integrated Research Environment
                </footer>
            </div>
        </div>
    );
};

export default Launcher;
