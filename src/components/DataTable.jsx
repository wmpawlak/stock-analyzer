import React from 'react';

const DataTable = ({ title, data }) => {
    if (!data || data.length === 0 || (data.length === 1 && data[0].error)) {
        return null;
    }

    const headers = Object.keys(data[0]);

    return (
        <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden animate-fadeIn">
            <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/50">
                <h3 className="text-lg font-bold text-white">{title}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-400">
                    <thead className="text-xs text-slate-300 uppercase bg-slate-800/50">
                        <tr>
                            {headers.map(header => (
                                <th key={header} scope="col" className="px-6 py-3">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, index) => (
                            <tr key={index} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                                {headers.map(header => (
                                    <td key={header} className="px-6 py-4">
                                        {row[header]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DataTable;