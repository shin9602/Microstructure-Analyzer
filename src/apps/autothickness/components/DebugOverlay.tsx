import React, { useEffect, useState, useRef } from 'react';
import { X, Trash2, RefreshCw } from 'lucide-react';

interface LogEntry {
    type: 'log' | 'warn' | 'error' | 'info';
    message: string;
    timestamp: string;
}

interface DebugOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    data: any; // Generic data to inspect
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({ isOpen, onClose, data }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [activeTab, setActiveTab] = useState<'console' | 'state'>('console');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Capture console logs
    useEffect(() => {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        const originalInfo = console.info;

        const addLog = (type: LogEntry['type'], args: any[]) => {
            const message = args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');

            setLogs(prev => [...prev.slice(-99), { // Keep last 100
                type,
                message,
                timestamp: new Date().toLocaleTimeString()
            }]);
        };

        console.log = (...args) => { addLog('log', args); originalLog(...args); };
        console.warn = (...args) => { addLog('warn', args); originalWarn(...args); };
        console.error = (...args) => { addLog('error', args); originalError(...args); };
        console.info = (...args) => { addLog('info', args); originalInfo(...args); };

        return () => {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
            console.info = originalInfo;
        };
    }, []);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[99999] pointer-events-none flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="pointer-events-auto w-[800px] h-[600px] bg-[#1e1e1e] text-white rounded-lg shadow-2xl flex flex-col font-mono text-sm border border-slate-700 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-black">
                    <div className="flex items-center gap-4">
                        <span className="font-bold text-amber-500">🛠️ 개발자 도구 (커스텀)</span>
                        <div className="flex bg-[#1e1e1e] rounded p-0.5">
                            <button
                                onClick={() => setActiveTab('console')}
                                className={`px-3 py-1 rounded ${activeTab === 'console' ? 'bg-[#007acc] text-white' : 'text-gray-400 hover:text-white'}`}
                            >콘솔 (Console)</button>
                            <button
                                onClick={() => setActiveTab('state')}
                                className={`px-3 py-1 rounded ${activeTab === 'state' ? 'bg-[#007acc] text-white' : 'text-gray-400 hover:text-white'}`}
                            >앱 상태 (State)</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setLogs([])} className="p-1 hover:bg-white/10 rounded" title="로그 지우기">
                            <Trash2 size={16} />
                        </button>
                        <button onClick={() => window.location.reload()} className="p-1 hover:bg-white/10 rounded" title="새로고침">
                            <RefreshCw size={16} />
                        </button>
                        <button onClick={onClose} className="p-1 hover:bg-red-500/50 rounded ml-2" title="닫기">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden relative">
                    {activeTab === 'console' ? (
                        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto p-4 space-y-1">
                            {logs.length === 0 && <div className="text-gray-500 italic">로그가 없습니다...</div>}
                            {logs.map((log, i) => (
                                <div key={i} className={`flex gap-2 border-b border-white/5 pb-1 ${log.type === 'error' ? 'text-red-400 bg-red-900/10' :
                                    log.type === 'warn' ? 'text-amber-400 bg-amber-900/10' :
                                        log.type === 'info' ? 'text-blue-300' : 'text-gray-300'
                                    }`}>
                                    <span className="text-gray-500 shrink-0">[{log.timestamp}]</span>
                                    <span className="break-all whitespace-pre-wrap">{log.message}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="absolute inset-0 overflow-y-auto p-4">
                            <pre className="text-green-400 text-xs">
                                {JSON.stringify(data, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
