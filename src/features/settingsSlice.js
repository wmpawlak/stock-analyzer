import { createSlice } from '@reduxjs/toolkit';
const initialState = {
    geminiApiKey: localStorage.getItem('geminiApiKey') || '',
    googleApiKey: localStorage.getItem('googleApiKey') || '',
    spreadsheetId: localStorage.getItem('spreadsheetId') || '',
    // Domyślne zakresy, które użytkownik będzie mógł edytować
    rangeTable: localStorage.getItem('rangeTable') ||
        'Arkusz1!A1:C10',
    rangeCharts: localStorage.getItem('rangeCharts') ||
        'Arkusz1!E1:F10',
};
const settingsSlice = createSlice({
    name: 'settings',
    initialState,
    reducers: {
        updateSettings: (state, action) => {
            const { geminiApiKey, googleApiKey, spreadsheetId,
                rangeTable, rangeCharts } = action.payload;
            state.geminiApiKey = geminiApiKey;
            state.googleApiKey = googleApiKey;
            state.spreadsheetId = spreadsheetId;
            state.rangeTable = rangeTable;
            state.rangeCharts = rangeCharts;
            // Zapisujemy wszystko w localStorage
            localStorage.setItem('geminiApiKey', geminiApiKey);
            localStorage.setItem('googleApiKey', googleApiKey);
            localStorage.setItem('spreadsheetId', spreadsheetId);
            localStorage.setItem('rangeTable', rangeTable);
            localStorage.setItem('rangeCharts', rangeCharts);
        },
        clearSettings: (state) => {
            localStorage.clear();
            return {
                geminiApiKey: '',
                googleApiKey: '',
                spreadsheetId: '',
                rangeTable: 'Arkusz1!A1:C10',
                rangeCharts: 'Arkusz1!E1:F10',
            };
        }
    },
});
export const { updateSettings, clearSettings } =
    settingsSlice.actions;
export default settingsSlice.reducer;