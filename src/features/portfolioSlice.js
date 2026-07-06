import { createSlice } from '@reduxjs/toolkit';

const PORTFOLIO_STORAGE_KEYS = [
  'portfolioAssets',
  'stockPortfolios',
  'portfolioHistory',
  'portfolioInputText',
  'portfolioHistoryText',
];

const loadFromCache = (key) => {
  try {
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
};

const initialState = {
  assets: loadFromCache('portfolioAssets'),
  stockPortfolios: loadFromCache('stockPortfolios'),
  portfolioHistory: loadFromCache('portfolioHistory'),
};

const portfolioSlice = createSlice({
  name: 'portfolio',
  initialState,
  reducers: {
    setAssets: (state, action) => {
      state.assets = action.payload;
      localStorage.setItem('portfolioAssets', JSON.stringify(action.payload));
    },
    addStockPortfolio: (state, action) => {
      const idx = state.stockPortfolios.findIndex((portfolio) => (
        portfolio.name === action.payload.name
      ));

      if (idx >= 0) state.stockPortfolios[idx] = action.payload;
      else state.stockPortfolios.push(action.payload);

      localStorage.setItem('stockPortfolios', JSON.stringify(state.stockPortfolios));
    },
    removeStockPortfolio: (state, action) => {
      state.stockPortfolios = state.stockPortfolios.filter((portfolio) => (
        portfolio.id !== action.payload
      ));
      localStorage.setItem('stockPortfolios', JSON.stringify(state.stockPortfolios));
    },
    setPortfolioHistory: (state, action) => {
      state.portfolioHistory = action.payload;
      localStorage.setItem('portfolioHistory', JSON.stringify(action.payload));
    },
    clearPortfolioData: (state) => {
      state.assets = [];
      state.stockPortfolios = [];
      state.portfolioHistory = [];
      PORTFOLIO_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    },
  },
});

export const {
  addStockPortfolio,
  clearPortfolioData,
  removeStockPortfolio,
  setAssets,
  setPortfolioHistory,
} = portfolioSlice.actions;

export default portfolioSlice.reducer;
