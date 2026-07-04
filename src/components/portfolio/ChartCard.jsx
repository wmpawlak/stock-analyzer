    const ChartCard = ({ title, children }) => (
      <div className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 shadow-xl shadow-black/20 flex flex-col h-full transition-all duration-300 hover:border-slate-700/50">
        <div className="border-b border-slate-800 pb-4 mb-5">
          <h2 className="text-lg font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">{title}</h2>
        </div>
        <div className="w-full flex-1 min-h-0 flex items-center justify-center">{children}</div>
      </div>
    );
    export default ChartCard;