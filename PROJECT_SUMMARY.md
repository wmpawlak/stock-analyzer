# Podsumowanie Projektu: Stock Analyzer

## Architektura

Stock Analyzer to lokalna aplikacja React/Vite. Dane portfela pozostają w `localStorage`, a moduł analizy używa dodatkowego helpera Node działającego wyłącznie na `127.0.0.1`.

- **UI:** React 19
- **Routing:** React Router
- **Stan aplikacji:** Redux Toolkit
- **Wykresy:** Recharts
- **Style:** Tailwind CSS 4
- **Źródła danych:** ręczny import tekstu/CSV oraz publiczne arkusze Google Sheets przez endpoint CSV
- **Testy jednostkowe:** wbudowany runner Node.js (`node --test`)
- **Analiza raportów:** lokalny helper Node, SQLite oraz katalog dokumentów `data/`

## Główne funkcje

1. Import ogólnego salda aktywów i historii wartości portfela.
2. Dashboard z tabelą alokacji, wykresem kołowym i wykresem historii.
3. Pobieranie wielu zakresów z Google Sheets i cache danych live.
4. Widok inwestycji na podstawie zakresów live.
5. Konfiguracja prowizji maklerskich.
6. Eksport backupu JSON i reset danych lokalnych.
7. Zakładka Analiza: profile instrumentów, źródła, kandydaci raportów, lokalne archiwum i wersjonowane szkice analiz.
8. Dwuetapowe użycie Perplexity: wyszukanie dokumentu i osobne uruchomienie analizy po zatwierdzeniu dokumentu.

## Ważne decyzje techniczne

- Dashboard korzysta ze wspólnego hooka `useDisplayedAssets()`, więc tabela i wykres kołowy pokazują to samo źródło danych.
- Dane live mają pierwszeństwo przed ręcznie wpisanymi aktywami, jeśli zawierają zakres `Podsumowanie aktywów`.
- Parser CSV jest wydzielony do `src/utils/csv.js` i obsługuje cytowane pola, przecinki w komórkach oraz ucieczone cudzysłowy.
- Parsery liczb i danych live są wydzielone do `src/utils`, aby można je było testować bez renderowania Reacta.
- `server/index.js` nie udostępnia klucza API frontendowi; odczytuje tylko `PERPLEXITY_API_KEY` z `.env.local` i nasłuchuje na `127.0.0.1`.
- `server/storage.js` przechowuje profile, źródła, dokumenty, analizy i budżet w SQLite. Oryginalne formaty są zachowywane, a ZIP jest sprawdzany przed rozpakowaniem.
- `src/utils/analysisAssets.js` mapuje `CDR:WSE` na `company:WSE:CDR` oraz `EIMI:LON` na `etf:IE00BKM4GZ66` i deduplikuje wspólny profil między portfelami.

## Kluczowe pliki

```text
src/
  components/
    portfolio/
      AssetPieChart.jsx
      PortfolioHistoryChart.jsx
      PortfolioTable.jsx
  features/
    portfolioSlice.js
    settingsSlice.js
  hooks/
    useDisplayedAssets.js
  pages/
    DataInput.jsx
    Investments.jsx
    LiveData.jsx
    Portfolio.jsx
    Settings.jsx
  utils/
    csv.js
    liveData.js
    number.js
tests/
  utils.test.js
```

## Ryzyka i ograniczenia

- Dane są lokalne dla konkretnej przeglądarki i profilu użytkownika.
- Google Sheets musi być udostępniony jako publiczny do odczytu dla osób z linkiem.
- Aplikacja nie ma zdalnego backendu ani szyfrowanej synchronizacji danych; helper analizy działa wyłącznie na komputerze użytkownika.
- Duże arkusze mogą zwiększać czas parsowania i rozmiar cache w `localStorage`.
- Limit wydatków Perplexity jest zabezpieczeniem po stronie aplikacji; limit oraz billing w konsoli dostawcy pozostają źródłem ostatecznym.
