    import { createSlice } from '@reduxjs/toolkit';

    const loadFromCache = (key) => {
      try {
        const cached = localStorage.getItem(key);
        return cached ? JSON.parse(cached) : [];
      } catch (e) { return []; }
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
          const idx = state.stockPortfolios.findIndex(p => p.name === action.payload.name);
          if (idx >= 0) state.stockPortfolios[idx] = action.payload;
          else state.stockPortfolios.push(action.payload);
          localStorage.setItem('stockPortfolios', JSON.stringify(state.stockPortfolios));
        },
        removeStockPortfolio: (state, action) => {
          state.stockPortfolios = state.stockPortfolios.filter(p => p.id !== action.payload);
          localStorage.setItem('stockPortfolios', JSON.stringify(state.stockPortfolios));
        },
        setPortfolioHistory: (state, action) => {
          state.portfolioHistory = action.payload;
          localStorage.setItem('portfolioHistory', JSON.stringify(action.payload));
        }
      }
    });

    export const { setAssets, addStockPortfolio, removeStockPortfolio, setPortfolioHistory } = portfolioSlice.actions;
    export default portfolioSlice.reducer;