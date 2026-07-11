import { createSlice } from '@reduxjs/toolkit';
import {
  readPersistentJson,
  removePersistentKey,
  writePersistentJson,
} from '../utils/persistentStorage.js';

const DEFAULT_RANGE_TABLE = 'Arkusz1!A1:C10';
const DEFAULT_RANGE_CHARTS = 'Arkusz1!E1:F10';

const initialState = {
  geminiApiKey: localStorage.getItem('geminiApiKey') || '',
  googleApiKey: localStorage.getItem('googleApiKey') || '',
  spreadsheetId: readPersistentJson('spreadsheetId', ''),
  rangeTable: readPersistentJson('rangeTable', DEFAULT_RANGE_TABLE),
  rangeCharts: readPersistentJson('rangeCharts', DEFAULT_RANGE_CHARTS),
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    updateSettings: (state, action) => {
      const {
        geminiApiKey,
        googleApiKey,
        spreadsheetId,
        rangeTable,
        rangeCharts,
      } = action.payload;

      state.geminiApiKey = geminiApiKey;
      state.googleApiKey = googleApiKey;
      state.spreadsheetId = spreadsheetId;
      state.rangeTable = rangeTable;
      state.rangeCharts = rangeCharts;

      localStorage.setItem('geminiApiKey', geminiApiKey);
      localStorage.setItem('googleApiKey', googleApiKey);
      void writePersistentJson('spreadsheetId', spreadsheetId);
      void writePersistentJson('rangeTable', rangeTable);
      void writePersistentJson('rangeCharts', rangeCharts);
    },
    clearSettings: () => {
      localStorage.removeItem('geminiApiKey');
      localStorage.removeItem('googleApiKey');
      ['spreadsheetId', 'rangeTable', 'rangeCharts'].forEach((key) => void removePersistentKey(key));
      return {
        geminiApiKey: '',
        googleApiKey: '',
        spreadsheetId: '',
        rangeTable: DEFAULT_RANGE_TABLE,
        rangeCharts: DEFAULT_RANGE_CHARTS,
      };
    },
  },
});

export const { updateSettings, clearSettings } = settingsSlice.actions;
export default settingsSlice.reducer;
