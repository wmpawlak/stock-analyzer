import React, { createContext, useContext, useMemo } from
    'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    setAssets, addStockPortfolio, removeStockPortfolio,
    setPortfolioHistory
} from '../features/portfolioSlice';
// Tworzymy Context
const PortfolioContext = createContext(null);
// Provider komponentu
export const PortfolioProvider = ({ children }) => {
    const dispatch = useDispatch();
    // Pobieramy stany bezpośrednio z Redux Store, aby były dostępne w całym Context w aplikacji
    const assets = useSelector((state) => state.portfolio.assets);
    const stockPortfolios = useSelector((state) =>
        state.portfolio.stockPortfolios);
    const portfolioHistory = useSelector((state) =>
        state.portfolio.portfolioHistory);
    // Globalne kalkulacje wartości sumarycznych
    const totalAssetsValue = useMemo(() => {
        return assets.reduce((sum, asset) => sum + asset.value, 0);
    }, [assets]);
    // Uniwersalna funkcja do parsowania walut/tekstu na liczby  (używana w DataInput i Wykresie)
    const parseCurrency = (str) => {
        if (!str) return 0;
        // Usuwa spacje, znacznik zł i zamienia przecinki na kropki
        return parseFloat(str.replace(/\s/g, '').replace('zł',
            '').replace(',', '.'));
    };
    // Uniwersalne formatowanie waluty do standardu PL
    const formatPLN = (value, maximumFractionDigits = 0) => {
        return new Intl.NumberFormat('pl-PL', {
            style: 'currency',
            currency: 'PLN',
            maximumFractionDigits: maximumFractionDigits,
        }).format(value);
    };
    // Uproszczona, ostateczna funkcja do generowania linków Google
    Finance
    const getGoogleFinanceLink = (query) => {
        if (!query) return '#';
        // Pobiera pierwszy wyraz przed spacją (np. z formatu "CDR:WSE" lub "PZU WSE")
        const ticker = query.trim().split(' ')[0];
        return `https://www.google.com/finance/quote/${ticker}`;
    };
    // Logika obliczania dynamicznej prowizji sprzedaży
    const calculateSellingCommission = (ticker, cenaSprzedazyRaw)
        => {
        const cenaSprzedazy = typeof cenaSprzedazyRaw === 'string'
            ? parseCurrency(cenaSprzedazyRaw)
            : cenaSprzedazyRaw;
        if (!cenaSprzedazy || cenaSprzedazy <= 0) return '0,00';
        let prowizja = 0;
        if (ticker.toUpperCase().includes('WSE')) {
            // GPW: 0,39% od wartości transakcji, minimum 5 zł
            prowizja = Math.max(5, cenaSprzedazy * 0.0039);
        } else {
            // Rynki zagraniczne: 0,29% od wartości transakcji, minimum 14 zł
            prowizja = Math.max(14, cenaSprzedazy * 0.0029);
        }
        return prowizja.toFixed(2).replace('.', ',');
    };
    // Zwijamy wartości w memo, aby uniknąć niepotrzebnych re-renderów w drzewie React
    const value = useMemo(() => ({
        assets,
        stockPortfolios,
        portfolioHistory,
        totalAssetsValue,
        parseCurrency,
        formatPLN,
        getGoogleFinanceLink,
        calculateSellingCommission,
        // Przekazujemy również akcje dispatchera jako proste metody
        updateAssets: (data) => dispatch(setAssets(data)),
        addPortfolio: (data) => dispatch(addStockPortfolio(data)),
        removePortfolio: (id) => dispatch(removeStockPortfolio(id)),
        updateHistory: (data) => dispatch(setPortfolioHistory(data))
    }), [assets, stockPortfolios, portfolioHistory,
        totalAssetsValue, dispatch]);
    return (
        <PortfolioContext.Provider value={value}>
            {children}
        </PortfolioContext.Provider>
    );
};
// Własny hook do łatwego importowania kontekstu w komponentach
export const usePortfolio = () => {
    const context = useContext(PortfolioContext);
    if (!context) {
        throw new Error('usePortfolio must be used within a PortfolioProvider');
    }
    return context;
};
