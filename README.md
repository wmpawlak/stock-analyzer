# Stock Analyzer

Lokalny dashboard do analizy portfela inwestycyjnego. Aplikacja zapisuje trwały stan w `data/analysis.sqlite` przez lokalnego helpera Node, a `localStorage` traktuje tylko jako cache startowy i warstwę kompatybilności.

## Funkcje

- import salda aktywów i historii portfela z wklejonego tekstu,
- import portfeli akcji/ETF z danych tabelarycznych,
- pobieranie wielu zakresów z Google Sheets do JSON,
- dashboard z tabelą alokacji, pie chartem i wykresem historii,
- widok inwestycji oparty na danych live,
- lokalna biblioteka raportów, dokumentów i analiz,
- pełny backup ZIP danych z `data/`.

## Wymagania

- Node.js zgodny z aktualnym Vite,
- npm.

## Uruchomienie

```bash
npm install
npm run dev
```

`npm run dev` uruchamia jednocześnie lokalnego helpera na `127.0.0.1:4310` i interfejs Vite. To jest zalecany tryb, ponieważ helper zapisuje dane do `data/`.

## Skrypty

```bash
npm run dev       # helper + Vite
npm run dev:vite  # sam interfejs Vite, tylko do diagnostyki
npm run helper    # samo API, SQLite i dokumenty na 127.0.0.1:4310
npm run build     # build produkcyjny
npm run preview   # podgląd builda
npm run lint      # analiza ESLint
npm run test      # testy jednostkowe Node.js
```

## Trwały Stan Aplikacji

Helper zapisuje w `data/analysis.sqlite` dane portfela, historię, dane live, konfiguracje Google Sheets, dane dummy, cache Alpha Vantage, preferencje kolumn i metadane analizy. Raporty, rozpakowane paczki ZIP i backupy są zapisywane w podkatalogach `data/`.

Przy pierwszym uruchomieniu po migracji aplikacja przenosi dozwolone dane ze starego `localStorage` do SQLite. Klucze API i sekrety nie są migrowane do `data/`; trzymaj je w `.env.local`.

Jeśli helper jest niedostępny, aplikacja może pokazać ostatni cache z przeglądarki, ale nowe zmiany nie są wtedy trwałe. Status w lewym panelu pokaże tryb cache.

## Dane Live z Google Sheets

1. Udostępnij arkusz jako `Każda osoba mająca link -> Przeglądający`.
2. Wklej link w zakładce `Dane Live`.
3. Opcjonalnie podaj nazwę zakładki i zakres, np. `A1:D20`.
4. Zapisz konfigurację lub pobierz dane jednorazowo.

Pobrane zakresy są zapisywane do `data/analysis.sqlite`, a przeglądarka zachowuje lokalny cache do szybkiego startu.

## Prywatność

Aplikacja nie wysyła danych portfela do zdalnego backendu projektu. Dane pozostają lokalne w `data/` i cache przeglądarki. Zewnętrzne requesty występują wyłącznie po świadomej akcji użytkownika: pobraniu Google Sheets, pobraniu wskazanego raportu albo uruchomieniu Perplexity dla zatwierdzonych dokumentów.

## Analiza Raportów

Zakładka **Analiza** jest lokalną biblioteką raportów i analiz dla aktywów z portfela oraz listy obserwowanych. Pilot zawiera profile:

- `CDR:WSE` -> CD PROJEKT,
- `EIMI:LON` -> iShares Core MSCI EM IMI UCITS ETF USD (Acc), ISIN `IE00BKM4GZ66`.

Helper zapisuje bazę, raporty, rozpakowane paczki ZIP i backupy w `data/`; katalog jest wykluczony z Gita. Klucz ustaw lokalnie w `.env.local`:

```env
PERPLEXITY_API_KEY=...
```

Nie używaj prefiksu `VITE_`: klucz pozostaje wyłącznie po stronie helpera. Samo otwarcie aktywa nie wykonuje żadnego zewnętrznego ani płatnego zapytania. Przepływ to: wyszukanie kandydata -> zatwierdzenie i lokalne archiwum oryginału -> analiza -> podgląd szkicu -> zatwierdzenie historii. Ręczny upload raportu jest dostępny w każdej chwili.

Wyszukanie używa modelu `sonar`, a analiza zatwierdzonych dokumentów `sonar-pro`. Aplikacja ma domyślny limit 10 USD miesięcznie i zapisuje koszt zwrócony przez API; ustawienia rozliczeń Perplexity nadal są ostateczną kontrolą wydatków. Wybrane dokumenty są wysyłane do Perplexity dopiero po kliknięciu **Analizuj**.

Pełny backup zawiera SQLite, wszystkie archiwalne dokumenty, manifest i dozwolony snapshot cache przeglądarki. Import przywraca dane analityczne i stan aplikacji z `data/`.
