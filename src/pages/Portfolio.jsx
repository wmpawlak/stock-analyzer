import PortfolioTable from '../components/portfolio/PortfolioTable';
import ChartCard from '../components/portfolio/ChartCard';
import AssetPieChart from '../components/portfolio/AssetPieChart';
import PortfolioHistoryChart from '../components/portfolio/PortfolioHistoryChart';
import AssetCategoryHistoryChart from '../components/portfolio/AssetCategoryHistoryChart';
import NetWorthChart from '../components/portfolio/NetWorthChart';

const Portfolio = () => {
  return (
    <div className="p-8 max-w-[1600px] mx-auto animate-fadeIn">
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">G\u0142\u00f3wny kokpit analityczny Twojego portfela inwestycyjnego.</p>
        </div>
        <div className="flex gap-2">
          <span className="text-xs font-semibold bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/50">
            Waluta: PLN
          </span>
          <span className="text-xs font-semibold bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/20">
            Aktualizacja: Live
          </span>
        </div>
      </div>

      {/* Podsumowanie Aktywów w Tabeli */}
      <PortfolioTable />

      <div className="grid grid-cols-1 gap-8 mb-8">
        {/* Wykres kołowy alokacji */}
        <ChartCard title="Alokacja Portfela (Rozkład Aktywów)">
          <AssetPieChart />
        </ChartCard>

        {/* Wykres historii wyceny */}
        <ChartCard title="Historia wyceny portfela">
          <PortfolioHistoryChart />
        </ChartCard>

        <ChartCard title="Historia kategorii aktywów">
          <AssetCategoryHistoryChart />
        </ChartCard>

        <ChartCard title="Wartość netto">
          <NetWorthChart />
        </ChartCard>
      </div>

      {/* Grid z przyszłymi kafelkami w luksusowej odsłonie */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-slate-700/50 transition-all duration-300">
          <div>
            <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Zyski vs Straty (YTD)</h3>
            <p className="text-slate-500 text-xs mt-1">Analiza dochodowości inwestycji w bieżącym roku</p>
          </div>
          <div className="text-slate-600 text-xs font-mono border-t border-slate-800/60 pt-3">
            Dane zostaną pobrane przy najbliższej synchronizacji...
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-slate-700/50 transition-all duration-300">
          <div>
            <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Efektywność Dywidendowa</h3>
            <p className="text-slate-500 text-xs mt-1">Prognozowane przepływy pasywne brutto/netto</p>
          </div>
          <div className="text-slate-600 text-xs font-mono border-t border-slate-800/60 pt-3">
            Brak zdefiniowanych spółek dywidendowych...
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 flex flex-col justify-between h-48 hover:border-slate-700/50 transition-all duration-300">
          <div>
            <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Sentyment rynkowy (Gemini AI)</h3>
            <p className="text-slate-500 text-xs mt-1">Automatyczne wnioski i prognozy z AI</p>
          </div>
          <div className="text-slate-600 text-xs font-mono border-t border-slate-800/60 pt-3">
            Wymagane dodanie klucza API w ustawieniach...
          </div>
        </div>
      </div>
    </div>
  );
};

export default Portfolio;
