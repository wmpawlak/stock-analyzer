import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const EditConfigModal = ({ config, onClose, onSave }) => {
    const [editedConfig, setEditedConfig] = useState(config);

    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setEditedConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = () => {
        onSave(editedConfig);
        onClose();
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fadeIn"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
                    <h3 className="text-lg font-bold text-white">Edytuj konfigurację</h3>
                </div>
                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Nazwa własna</label>
                        <input
                            type="text"
                            name="name"
                            value={editedConfig.name}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Link udostępniania</label>
                        <input
                            type="text"
                            name="url"
                            value={editedConfig.url}
                            onChange={handleChange}
                            className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: Zakładka</label>
                            <input
                                type="text"
                                name="sheetName"
                                value={editedConfig.sheetName}
                                onChange={handleChange}
                                className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Opcjonalnie: Zakres</label>
                            <input
                                type="text"
                                name="range"
                                value={editedConfig.range}
                                onChange={handleChange}
                                className="w-full p-2.5 bg-slate-950/70 border border-slate-700/50 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-900/50 border-t border-slate-800/80 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-slate-800 text-slate-300 hover:bg-slate-700"
                    >
                        Anuluj
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 font-medium text-xs rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-500"
                    >
                        Zapisz zmiany
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default EditConfigModal;
