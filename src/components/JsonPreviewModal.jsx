import React from 'react';

const JsonPreviewModal = ({ jsonData, onClose }) => {
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fadeIn p-4">
            <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
                <div className="px-6 py-5 border-b border-slate-800/80 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Przetworzone Dane (JSON)</h3>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={downloadJson}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-700 font-medium text-sm text-slate-300 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Pobierz
                        </button>
                        <button
                            onClick={onClose}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="p-0 bg-slate-950 flex-1 overflow-y-auto">
                    <pre className="p-4 text-xs font-mono text-emerald-400">
                        {JSON.stringify(jsonData, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
};

export default JsonPreviewModal;