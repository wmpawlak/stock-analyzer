Tabela metryk - jeśli kolumna jest Q1 2026 i obok jest druga na 31.03.2026 - czyli ostatni dzień Q1 - to wolałbym żeby to była jedna kolumna a nie dwie - i analogicznie dla 30.06.2026, 30.09.2026 i 31.12.2026 do odpowiednich kwartałów Q2, Q3, Q4.
Upewnić się że wszystkie dane mają swoje odzwierciedlenie w realnych plikach a nie tylko local storage
$env:NODE_OPTIONS='--use-system-ca'
npx ccusage@latest codex daily
Moduł który wyliczy moje tempo oszczędzania i do zakładanego dnia wolności finansowej


`Przeanalizuj zatwierdzone dokumenty dla aktywa poniżej. Odpowiedź musi być po polsku i wyłącznie jako JSON zgodny ze schematem.

Cel pracy:
1. Ekstrakcja faktów: znajdź metryki z katalogu metryk, używając metricKey, aliasów i słów kluczowych.
2. Kompozycja analizy: napisz summary, structuredSummary, risks i conclusions wyłącznie na podstawie wyekstrahowanych faktów i cytowanych fragmentów dokumentu.

Twarde reguły:
- Nie zgaduj. Brak pewnego źródła oznacza brak metricFact i wpis w extractionWarnings.
- Katalog poniżej jest jedyną listą dozwolonych metricKey. Przejdź kolejno przez każdy wpis katalogu i dla każdego metricKey wykonaj osobną próbę odnalezienia metryki w dokumencie.
- Przy wyszukiwaniu każdego metricKey używaj łącznie jego pól shortName, namePl, nameEn, aliases, keywords, description, valueType i aggregation. metricKey jest identyfikatorem wyniku, a nazwa w dokumencie może być polska, angielska, skrócona albo opisana jednym z aliasów.
- Jeżeli znajdziesz wiarygodną wartość zgodną z definicją, typem wartości, jednostką i okresem danego wpisu katalogu, zwróć ją jako metricFact z dokładnie tym metricKey. Nie wymagaj dosłownego wystąpienia samego tekstu metricKey w dokumencie.
- Metryki z tier primary traktuj jako obowiązkową checklistę: brak wiarygodnego źródła opisz w extractionWarnings. Metryk z tier secondary również aktywnie szukaj i zwróć je, gdy są dobrze uźródłowione; ich braku nie musisz dodawać do extractionWarnings.
- Nie zbieraj dowolnych liczb ani KPI spoza katalogu jako metricFacts.
- Przy tekstach wyciągniętych lokalnie z PDF/OCR nie wymagaj idealnego tekstu tabeli: jeżeli nagłówek okresów, kolejność kolumn, etykieta metryki i wartości są widoczne w tym samym fragmencie lub bezpośrednim sąsiedztwie tabeli, zwróć metricFacts z niższą confidence zamiast odrzucać całą metrykę.
- Artefakty OCR, dodatkowe spacje i rozdzielone litery nie są same w sobie powodem do pominięcia metryki, jeżeli kontekst tabeli pozwala jednoznacznie przypisać wartość do okresu. Nigdy nie sklejaj cyfr z sąsiednich kolumn. Gdy w wierszu występuje kilka wartości, dopasuj każdą komórkę do jej nagłówka i wybierz wyłącznie komórkę okresu głównego raportu.
- Zachowuj strukturę tekstu wyodrębnionego lokalnie: podziały linii odzwierciedlają wiersze PDF, a komórki w jednej linii należą do tego samego wiersza tabeli. Etykieta zawinięta do kolejnej linii nadal należy do poprzedniego wiersza, jeśli nie zaczyna nowego zestawu wartości.
- Dla kwot pieniężnych użyj dokładnie waluty i skali widocznej w raporcie, np. tys. PLN, mln EUR, USD albo EUR/akcję. Nie przeliczaj walut i nie preferuj PLN. Brak widocznej jednostki przy kwocie oznacza brak metricFact i wpis w extractionWarnings. Dla wskaźników procentowych wystarczy widoczny znak procentu przy wartości i jednoznaczny nagłówek okresu.
- Każda liczba w metricFacts musi mieć metricKey, label, value, unit, period, page, section, quote i confidence.
- Każde risk i conclusion musi mieć source z documentId, page, section i evidence.
- quote oraz source.evidence mają być krótkimi dowodami z dokumentu, nie parafrazą bez zakotwiczenia.
- Jeżeli numer strony nie jest dostępny w narzędziu, ustaw page na null, ale nadal wypełnij section i quote/evidence.
- value ma być samą liczbą albo null; pełna jednostka wraz z walutą i skalą trafia tylko do unit.
- Czytaj wartości tylko z kolumny okresu głównego raportu. Przykład: w raporcie Q1 2025 zwracaj metricFacts tylko dla Q1 2025, a kolumnę Q1 2024 pomiń jako metricFacts.
- Dla każdej metryki zwróć najwyżej jeden metricFact dla okresu raportu. Jeżeli ta sama tabela pokazuje Q1 2025 oraz Q1 2024, wybierz wyłącznie Q1 2025, gdy raport dotyczy Q1 2025.
- metricKey cost_of_risk oznacza wyłącznie wskaźnik CoR wyrażony w % albo bps. Nie przypisuj do niego kwot pozycji "wynik z tytułu oczekiwanych strat kredytowych", "odpisy aktualizujące" ani "koszty ryzyka prawnego". Takie kwoty nie są CoR i nie mają osobnego metricKey w katalogu.
- Normalizuj okresy kwartalne do formatu Q1 YYYY, Q2 YYYY, Q3 YYYY albo Q4 YYYY. Równoważniki okresów to: Q1 = 31.03.YYYY lub 01.01.YYYY-31.03.YYYY; Q2 = 30.06.YYYY lub 01.04.YYYY-30.06.YYYY; Q3 = 30.09.YYYY lub 01.07.YYYY-30.09.YYYY; Q4 = 31.12.YYYY lub 01.10.YYYY-31.12.YYYY.
- Zakresów narastających 01.01.YYYY-30.06.YYYY i 01.01.YYYY-30.09.YYYY nie traktuj jako czystych Q2 ani Q3 i nie używaj ich jako metricFacts dla raportu kwartalnego.
- Jeżeli tabela pokazuje datę bilansową będącą końcem kwartału, w polu period wpisz kwartał, np. Q1 2026 zamiast 31.03.2026.
- Nie twórz metricFacts dla okresów porównawczych, nawet jeżeli wartości są bezpośrednio widoczne w dokumencie.
- Nie zwracaj rekomendacji kupna/sprzedaży.

Reguły structuredSummary:
- Pisz jak analityk dla człowieka: przystępnie, konkretnie i bez suchego wyliczania liczb.
- structuredSummary.headline ma zawierać jedną najważniejszą tezę z raportu.
- structuredSummary.stance ustaw jako syntetyczną ocenę tonu raportu bez rekomendacji inwestycyjnej: pozytywny, mieszany, ostrozny albo negatywny.
- structuredSummary.sections ma zawierać sekcje: Najważniejsze fakty, Zmiana vs rok temu, Jakość wyniku, Ryzyka i kapitał, Co sprawdzić dalej. Dla profilu niebankowego dopasuj nazwy do raportu, ale zachowaj sens tych obszarów.
- W bullets wyjaśniaj znaczenie danych: co jest korzystne lub niekorzystne, co się poprawiło lub pogorszyło, co wygląda na jednorazowe lub powtarzalne, jakie ryzyka mogą zniekształcać obraz oraz co użytkownik powinien sprawdzić w kolejnym kroku.
- Gdy bullet opiera się na liczbach, dodaj metricKeys z odpowiednimi metricKey z katalogu i source, jeżeli wniosek ma bezpośrednie zakotwiczenie w dokumencie.

Pozbądź się sekcji "źródła" gdzie się wkleja linki do stron, oraz pozbądź się sekcji "kandydaci dokumentów" - będę tylko ręcznie wgrywał. Pozbądź się też sekcji lokalny budżet i backup. Sprawdzę sobie koszty w developer portalach danych API.