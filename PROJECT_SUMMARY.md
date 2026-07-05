# Podsumowanie Projektu: Stock Analyzer

## 1. Architektura Projektu

Aplikacja jest zbudowana jako **Single-Page Application (SPA)** w architekturze **client-side**. Oznacza to, że cała logika aplikacji działa w przeglądarce użytkownika, bez potrzeby komunikacji z serwerem backendowym.

- **Framework:** Sercem aplikacji jest biblioteka **React**, która zarządza interfejsem użytkownika w sposób komponentowy.
- **State Management:** Stan aplikacji (wszystkie dane portfelowe, historia, konfiguracje) jest zarządzany centralnie przy użyciu **Redux Toolkit**. Główne dane trzymane są w jednym "slice" (`portfolioSlice`), co ułatwia zarządzanie i śledzenie zmian.
- **Routing:** Nawigacja pomiędzy podstronami (Portfel, Dane wejściowe, Ustawienia, Dane Live) jest obsługiwana przez bibliotekę **React Router**.
- **Styling:** Interfejs jest stylowany przy użyciu **Tailwind CSS**. To podejście "utility-first" pozwala na szybkie budowanie spójnego i nowoczesnego designu bezpośrednio w plikach JSX. Globalne style i motyw (ciemny) zdefiniowane są w `src/index.css`.
- **Data Persistence:** Kluczowym elementem architektury jest **przechowywanie danych w `localStorage` przeglądarki**. Dzięki temu wszystkie wprowadzone dane, zapisane konfiguracje i ustawienia są dostępne nawet po zamknięciu i ponownym otwarciu przeglądarki. Aplikacja jest więc w pełni funkcjonalna lokalnie.
- **Build Tool:** Projekt wykorzystuje **Vite** jako narzędzie do budowania i serwer deweloperski, co zapewnia błyskawiczne przeładowywanie i optymalizację kodu.

## 2. Cel i Zakres Projektu

**Cel:** Głównym celem projektu jest stworzenie osobistego, w pełni prywatnego i działającego lokalnie **dashboardu do analizy portfela inwestycyjnego**. Aplikacja ma za zadanie agregować, przetwarzać i wizualizować dane finansowe w czytelny i interaktywny sposób.

**Zakres Funkcjonalny:**
1.  **Wprowadzanie Danych:** Użytkownik może wklejać dane skopiowane bezpośrednio z arkuszy kalkulacyjnych (np. Excela) w dedykowanych polach tekstowych. Aplikacja automatycznie je parsuje.
2.  **Wizualizacja Portfela:** Prezentacja zagregowanych danych w formie tabelarycznej oraz za pomocą interaktywnych wykresów (kołowy wykres alokacji, historyczny wykres wartości portfela).
3.  **Integracja z Google Sheets:** Możliwość dynamicznego pobierania danych na żywo z udostępnionych arkuszy Google, co pozwala na automatyzację bez konieczności ręcznego kopiowania danych.
4.  **Zarządzanie Konfiguracjami:** Użytkownik może zapisywać wiele różnych konfiguracji połączeń do arkuszy (różne linki, zakładki, zakresy) i odświeżać je wszystkie jednym kliknięciem.
5.  **Personalizacja i Ustawienia:** Możliwość konfiguracji stawek prowizji maklerskich.
6.  **Zarządzanie Danymi:** Funkcje eksportu wszystkich danych do pliku JSON (backup) oraz całkowitego resetu aplikacji do stanu początkowego.

## 3. Drzewko Plików i Opis

Oto uproszczona struktura kluczowych plików projektu i ich przeznaczenie:

```
stock-analyzer/
├── public/
│   └── ... (ikony i statyczne zasoby)
├── src/
│   ├── assets/
│   │   └── ... (obrazy używane w projekcie)
│   ├── components/
│   │   └── portfolio/
│   │       ├── AssetPieChart.jsx      # Komponent wykresu kołowego (Recharts)
│   │       ├── ChartCard.jsx          # Komponent-kontener dla każdego wykresu
│   │       ├── PortfolioHistoryChart.jsx # Komponent wykresu historycznego
│   │       └── PortfolioTable.jsx     # Komponent tabeli z podsumowaniem aktywów
│   ├── features/
│   │   └── portfolioSlice.js        # Definicja stanu Redux (dane, akcje, reducery)
│   ├── pages/
│   │   ├── DataInput.jsx            # Strona do wklejania i parsowania danych
│   │   ├── LiveData.jsx             # Strona do integracji z Google Sheets
│   │   ├── Portfolio.jsx            # Główny dashboard z wizualizacjami
│   │   └── Settings.jsx             # Strona ustawień, eksportu i resetu danych
│   ├── App.jsx                      # Główny komponent aplikacji (layout, routing)
│   ├── index.css                    # Globalne style, konfiguracja Tailwind
│   └── main.jsx                     # Punkt wejścia aplikacji, renderowanie React i podpięcie Redux
├── .gitignore                       # Plik ignorujący niepotrzebne pliki (np. node_modules)
├── index.html                       # Główny plik HTML, w którym montowana jest aplikacja
├── package.json                     # Definicja projektu, zależności i skrypty
└── vite.config.js                   # Konfiguracja narzędzia budującego Vite
```

## 4. Użyte Technologie i Biblioteki

Na podstawie pliku `package.json`, oto lista kluczowych zależności:

- **Framework i UI:**
    - `react`, `react-dom`: Biblioteka do budowania interfejsu użytkownika.
- **Routing:**
    - `react-router-dom`: Do obsługi nawigacji i routingu w aplikacji.
- **Zarządzanie Stanem:**
    - `@reduxjs/toolkit`, `react-redux`: Oficjalny, nowoczesny sposób na zarządzanie stanem aplikacji z Redux.
- **Styling:**
    - `tailwindcss`: Framework CSS do szybkiego stylowania za pomocą klas "utility-first".
- **Wykresy i Wizualizacja Danych:**
    - `recharts`: Biblioteka do tworzenia interaktywnych, konfigurowalnych wykresów.
- **Narzędzia Deweloperskie:**
    - `vite`: Nowoczesne i ultraszybkie narzędzie do budowania projektów frontendowych.
    - `@vitejs/plugin-react`: Oficjalny plugin Vite do obsługi projektów React.
    - `eslint`: Narzędzie do statycznej analizy kodu (linting), pomagające utrzymać jego jakość i spójność.
