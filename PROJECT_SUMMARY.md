# Podsumowanie Projektu: Stock Analyzer

## Architektura

Stock Analyzer to lokalna aplikacja React/Vite z helperem Node działającym wyłącznie na `127.0.0.1`. Trwałym źródłem prawdy jest katalog `data/`: SQLite przechowuje stan aplikacji, metadane analiz i budżet, a pliki dokumentów oraz backupy trafiają do podkatalogów `data/`. `localStorage` jest cache startowym i warstwą kompatybilności.

- **UI:** React 19
- **Routing:** React Router
- **Stan aplikacji:** Redux Toolkit + lokalny `app_state` w SQLite
- **Wykresy:** Recharts
- **Style:** Tailwind CSS 4
- **Źródła danych:** ręczny import tekstu/CSV, publiczne arkusze Google Sheets przez endpoint CSV, Alpha Vantage cache
- **Testy jednostkowe:** wbudowany runner Node.js (`node --test`)
- **Analiza raportów:** lokalny helper Node, SQLite oraz katalog dokumentów `data/`

## Główne Funkcje

1. Import ogólnego salda aktywów i historii wartości portfela.
2. Dashboard z tabelą alokacji, wykresem kołowym i wykresem historii.
3. Pobieranie wielu zakresów z Google Sheets i trwały zapis danych live.
4. Widok inwestycji na podstawie zakresów live.
5. Konfiguracja prowizji maklerskich.
6. Pełny backup ZIP i reset danych lokalnych.
7. Zakładka Analiza: profile instrumentów, źródła, kandydaci raportów, lokalne archiwum i wersjonowane szkice analiz.
8. Dwuetapowe użycie Perplexity: wyszukanie dokumentu i osobne uruchomienie analizy po zatwierdzeniu dokumentu.

## Ważne Decyzje Techniczne

- `npm run dev` uruchamia helper i Vite razem, ponieważ helper zapisuje trwały stan w `data/`.
- `server/storage.js` przechowuje `app_state`, profile, źródła, dokumenty, analizy i budżet w SQLite. Oryginalne formaty dokumentów są zachowywane, a ZIP jest sprawdzany przed rozpakowaniem.
- `src/utils/persistentStorage.js` migruje stare dozwolone dane z `localStorage`, hydratuje cache z backendu i zapisuje zmiany przez `/api/analysis/state`.
- Sekrety i klucze API nie są migrowane do `data/`; `PERPLEXITY_API_KEY` jest czytany z `.env.local`.
- Dashboard korzysta ze wspólnego hooka `useDisplayedAssets()`, więc tabela i wykres kołowy pokazują to samo źródło danych.
- Dane live mają pierwszeństwo przed ręcznie wpisanymi aktywami, jeśli zawierają zakres `Podsumowanie aktywów`.
- Parser CSV jest wydzielony do `src/utils/csv.js` i obsługuje cytowane pola, przecinki w komórkach oraz ucieczone cudzysłowy.
- `src/utils/analysisAssets.js` mapuje `CDR:WSE` na `company:WSE:CDR` oraz `EIMI:LON` na `etf:IE00BKM4GZ66` i deduplikuje wspólny profil między portfelami.

## Kluczowe Pliki

```text
server/
  index.js
  storage.js
src/
  features/
    portfolioSlice.js
    settingsSlice.js
  hooks/
    useDisplayedAssets.js
    useLiveData.js
  pages/
    Analysis.jsx
    DataInput.jsx
    Investments.jsx
    LiveData.jsx
    Portfolio.jsx
    Settings.jsx
  utils/
    analysisApi.js
    csv.js
    liveData.js
    number.js
    persistentStorage.js
tests/
  analysisHelper.test.js
  utils.test.js
```

## Ryzyka I Ograniczenia

- Katalog `data/` jest lokalnym źródłem prawdy; reinstalacja aplikacji musi zachować ten folder.
- Jeśli helper jest offline, aplikacja działa z cache przeglądarki, ale nowe zmiany nie są trwale zapisane.
- Google Sheets musi być udostępniony jako publiczny do odczytu dla osób z linkiem.
- Aplikacja nie ma zdalnego backendu ani szyfrowanej synchronizacji danych; helper działa wyłącznie na komputerze użytkownika.
- Duże arkusze mogą zwiększać czas parsowania i rozmiar lokalnej bazy/cache.
- Limit wydatków Perplexity jest zabezpieczeniem po stronie aplikacji; limit oraz billing w konsoli dostawcy pozostają źródłem ostatecznym.
