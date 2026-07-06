import { csvToObjects } from './csv.js';

export const fetchSheetData = async (url, sheetName, range) => {
  if (!url) {
    throw new Error('Podaj link udostępniania arkusza Google.');
  }

  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error('Nie udało się rozpoznać ID arkusza. Link powinien zawierać /spreadsheets/d/TWOJE_ID/.');
  }

  const spreadsheetId = match[1];
  const fetchUrl = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  fetchUrl.searchParams.set('tqx', 'out:csv');

  if (sheetName) fetchUrl.searchParams.set('sheet', sheetName);
  if (range) fetchUrl.searchParams.set('range', range);

  const response = await fetch(fetchUrl.toString());
  if (!response.ok) {
    throw new Error('Błąd pobierania danych. Upewnij się, że arkusz jest udostępniony jako "Każda osoba mająca link -> Przeglądający".');
  }

  const csvText = await response.text();
  const trimmedCsv = csvText.trim();

  if (trimmedCsv.startsWith('<!DOCTYPE html>') || trimmedCsv.startsWith('<html')) {
    throw new Error('Pobrane dane wyglądają jak strona HTML. Sprawdź ustawienia udostępniania arkusza.');
  }

  const data = csvToObjects(csvText);
  if (data.length === 0) {
    throw new Error('Pobrany plik CSV jest pusty.');
  }

  return data;
};
