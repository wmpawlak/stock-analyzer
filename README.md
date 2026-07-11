# Stock Analyzer

Lokalny dashboard do analizy portfela inwestycyjnego. Aplikacja działa w przeglądarce, zapisuje dane w `localStorage` i może pobierać dane live z publicznie udostępnionych arkuszy Google Sheets.

## Funkcje

- import salda aktywów i historii portfela z wklejonego tekstu,
- import portfeli akcji/ETF z danych tabelarycznych,
- pobieranie wielu zakresów z Google Sheets do JSON,
- dashboard z tabelą alokacji, pie chartem i wykresem historii,
- widok inwestycji oparty na danych live,
- backup danych do JSON,
- reset danych lokalnych.

## Wymagania

- Node.js zgodny z aktualnym Vite,
- npm.

## Uruchomienie

```bash
npm install
npm run dev
```

Domyślnie Vite pokaże lokalny adres aplikacji w terminalu.

## Skrypty

```bash
npm run dev      # serwer developerski
npm run build    # build produkcyjny
npm run preview  # podgląd builda
npm run lint     # analiza ESLint
npm run test     # testy jednostkowe Node.js
```

## Dane Live z Google Sheets

1. Udostępnij arkusz jako `Każda osoba mająca link -> Przeglądający`.
2. Wklej link w zakładce `Dane Live`.
3. Opcjonalnie podaj nazwę zakładki i zakres, np. `A1:D20`.
4. Zapisz konfigurację lub pobierz dane jednorazowo.

Dashboard używa danych live, jeśli cache zawiera zakres o nazwie `Podsumowanie aktywów`. Wtedy tabela i wykres kołowy pokazują to samo źródło danych.

## Prywatność

Aplikacja nie wysyła danych portfela do zdalnego backendu projektu. Dane portfela pozostają lokalne. Zewnętrzne requesty występują wyłącznie po świadomej akcji użytkownika: pobraniu Google Sheets, pobraniu wskazanego raportu albo uruchomieniu Perplexity dla zatwierdzonych dokumentów.

## Analiza raportów

Zakładka **Analiza** jest lokalną biblioteką raportów i analiz dla aktywów z portfela oraz listy obserwowanych. Pilot zawiera profile:

- `CDR:WSE` → CD PROJEKT,
- `EIMI:LON` → iShares Core MSCI EM IMI UCITS ETF USD (Acc), ISIN `IE00BKM4GZ66`.

Uruchomienie w trybie deweloperskim razem z lokalnym helperem:

```bash
npm run dev:all
```

Można też uruchomić je osobno:

```bash
npm run helper # API, SQLite i dokumenty na 127.0.0.1:4310
npm run dev    # interfejs Vite
```

Helper zapisuje bazę, raporty, rozpakowane paczki ZIP i backupy w `data/`; katalog jest wykluczony z Gita. Klucz ustaw lokalnie w `.env.local`:

```env
PERPLEXITY_API_KEY=...
```

Nie używaj prefiksu `VITE_`: klucz pozostaje wyłącznie po stronie helpera. Samo otwarcie aktywa nie wykonuje żadnego zewnętrznego ani płatnego zapytania. Przepływ to: wyszukanie kandydata → zatwierdzenie i lokalne archiwum oryginału → analiza → podgląd szkicu → zatwierdzenie historii. Ręczny upload raportu jest dostępny w każdej chwili.

Wyszukanie używa modelu `sonar`, a analiza zatwierdzonych dokumentów `sonar-pro`. Aplikacja ma domyślny limit 10 USD miesięcznie i zapisuje koszt zwrócony przez API; ustawienia rozliczeń Perplexity nadal są ostateczną kontrolą wydatków. Wybrane dokumenty są wysyłane do Perplexity dopiero po kliknięciu **Analizuj**. Perplexity obsługuje załączniki PDF/DOC/DOCX/TXT/RTF oraz JSON Schema w odpowiedziach, co wykorzystuje helper. [Dokumentacja załączników](https://docs.perplexity.ai/docs/sonar/media), [structured outputs](https://docs.perplexity.ai/docs/sonar/features).

Pełny backup zawiera SQLite, wszystkie archiwalne dokumenty, manifest i snapshot `localStorage` przeglądarki. Import przywraca dane analityczne, a po rozpoznaniu snapshotu odświeża aplikację.
