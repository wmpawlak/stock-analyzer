    import { configureStore } from '@reduxjs/toolkit';
    import settingsReducer from './features/settingsSlice';
    import portfolioReducer from './features/portfolioSlice';

    export const store = configureStore({
      reducer: {
        settings: settingsReducer,
        portfolio: portfolioReducer,
      },
    });