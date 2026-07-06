import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const JsonPreviewModal = ({ jsonData, onClose }) => {
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const downloadJson = () => {

        if (!jsonData) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(jsonData, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `dane_live_${new Date().toISOString().split('T')[0]}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
    };

    const formattedJson = JSON.stringify(jsonData, null, 2);

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] mx-4 overflow-hidden flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white">Przetworzone Dane (JSON)</h3>
                        <p className="mt-1 text-xs text-slate-500 font-mono truncate">{formattedJson.length.toLocaleString('pl-PL')} znaków</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                            aria-label="Zamknij podgląd JSON"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="p-6 bg-slate-950/40 flex-1 min-h-0">
                    <div className="h-full max-h-[62vh] overflow-auto rounded-xl border border-slate-800/80 bg-slate-950 shadow-inner">
                        <pre className="p-5 text-xs leading-5 font-mono text-emerald-300 whitespace-pre min-w-max">{formattedJson}</pre>
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-900/50 border-t border-slate-800/80 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700"
                    >
                        Zamknij
                    </button>
                    <button
                        onClick={downloadJson}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-500"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Pobierz JSON
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};


export default JsonPreviewModal;
