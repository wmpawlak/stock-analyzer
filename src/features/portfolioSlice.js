import { createSlice } from '@reduxjs/toolkit';
import {
  readPersistentJson,
  removePersistentKey,
  writePersistentJson,
} from '../utils/persistentStorage.js';

const PORTFOLIO_STORAGE_KEYS = [
  'portfolioAssets',
  'stockPortfolios',
  'portfolioHistory',
  'portfolioInputText',
  'portfolioHistoryText',
];

const loadFromCache = (key) => {
  return readPersistentJson(key, []);
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
      void writePersistentJson('portfolioAssets', action.payload);
    },
    addStockPortfolio: (state, action) => {
      const idx = state.stockPortfolios.findIndex((portfolio) => (
        portfolio.name === action.payload.name
      ));

      if (idx >= 0) state.stockPortfolios[idx] = action.payload;
      else state.stockPortfolios.push(action.payload);

      void writePersistentJson('stockPortfolios', state.stockPortfolios);
    },
    removeStockPortfolio: (state, action) => {
      state.stockPortfolios = state.stockPortfolios.filter((portfolio) => (
        portfolio.id !== action.payload
      ));
      void writePersistentJson('stockPortfolios', state.stockPortfolios);
    },
    setPortfolioHistory: (state, action) => {
      state.portfolioHistory = action.payload;
      void writePersistentJson('portfolioHistory', action.payload);
    },
    clearPortfolioData: (state) => {
      state.assets = [];
      state.stockPortfolios = [];
      state.portfolioHistory = [];
      PORTFOLIO_STORAGE_KEYS.forEach((key) => void removePersistentKey(key));
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
