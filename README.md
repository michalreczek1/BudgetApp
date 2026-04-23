# Budget App - plan modulu rozliczen najmu

## Cel modulu

Celem jest rozbudowanie obecnej Budget App o kompletny modul rozliczen najmu, ktory zastapi arkusz Excel `ROZLICZENIA Z NAJEMCAMI.xlsx`.

Modul ma obslugiwac codzienna prace wlasciciela mieszkania:

- oznaczanie, kto zaplacil i kto nadal zalega,
- edycje najemcow, kwot, terminow i umow,
- rozliczenia miesieczne zgodne z logika obecnego Excela,
- podatek miesieczny i roczny,
- wydatki i zaliczki na media,
- wyliczenie pola `Mój przychód`,
- import wyciagow bankowych i dopasowywanie przelewow do najemcow,
- raporty roczne i eksport danych dla ksiegowego.

Nowa funkcjonalnosc powinna powstac jako modul obecnej Budget App, nie jako osobna aplikacja. Dzieki temu zostana wykorzystane istniejace: logowanie, SQLite, backupy, saldo, wplywy, wydatki i obecny zalazek modulu najemcow.

## Widoki aplikacji

Modul `Najem` ma miec piec glownych widokow.

### Miesiac

Widok do pracy operacyjnej w aktualnym lub wybranym miesiacu.

Powinien pokazywac:

- liste aktywnych najemcow,
- termin platnosci,
- kwote oczekiwanego przelewu,
- czesc czynszowa,
- zaliczki na media,
- inne oplaty,
- status: `niezaplacone`, `czesciowo`, `zaplacone`, `nadplata`, `po terminie`,
- date i kwote faktycznej wplaty,
- podatek miesieczny,
- `Zarządzanie Marek`,
- `Mój przychód`,
- saldo mediow,
- notatki i rozbieznosci.

Widok musi pozwalac na szybka edycje kwot, oznaczenie wplaty jako zaplaconej, cofniecie wplaty i zachowanie snapshotu historycznego dla miesiaca.

### Rok

Widok roczny ma dzialac jak przewijana rolka albo arkusz podobny do Excela. Ma dawac szybki podglad wszystkich miesiecy wybranego roku bez przelaczania sie miedzy osobnymi ekranami.

Powinien zawierac:

- filtr roku,
- przewijana tabele wszystkich miesiecy,
- najemcow i ich miesieczne kwoty,
- sume przelewow,
- czynsz opodatkowany,
- media pobrane,
- media zaplacone,
- kary, kaucje, doplaty i wyrownania,
- `Zarządzanie Marek`,
- `Mój przychód`,
- podatek miesiaca,
- podatek narastajaco,
- zaleglosci,
- rozbieznosci miedzy oczekiwanymi i faktycznymi wplatami.

Na desktopie tabela moze byc szeroka i przewijana poziomo. Na telefonie musi pozostac czytelna: miesiace moga byc ukladane jako sekcje jedna pod druga, ale bez rozjezdzania kolumn i bez nakladania tekstu.

### Najemcy

Widok administracyjny dla danych najemcow i umow.

Powinien obslugiwac:

- aktywnych i nieaktywnych najemcow,
- pokoje/lokale,
- aliasy do dopasowywania przelewow,
- kwoty domyslne,
- dzien platnosci,
- okres obowiazywania umowy,
- notatki,
- historie zmian.

Zmiana danych przyszlej umowy nie moze psuc rozliczen historycznych. Miesieczne naliczenia maja byc snapshotem.

### Import banku

Widok do wrzucania wyciagow bankowych i zatwierdzania sugestii dopasowania.

MVP ma obslugiwac upload plikow:

- `CSV`,
- `XLSX`,
- `PDF`.

Przeplyw:

1. Uzytkownik wrzuca wyciag.
2. Backend parsuje transakcje: date, kwote, kontrahenta, tytul, numer rachunku jesli jest dostepny.
3. System deduplikuje transakcje.
4. Reguly lokalne proponuja dopasowania po aliasach, kwocie i oknie dat wokol terminu platnosci.
5. Grok albo inny LLM pomaga tylko przy niejasnych opisach.
6. Uzytkownik zatwierdza albo odrzuca sugestie.
7. Dopiero zatwierdzone sugestie ksieguja wplaty.

LLM nie moze automatycznie ksiegowac pieniedzy bez akceptacji uzytkownika.

### Raporty

Widok raportowy dla podatkow, cashflow i eksportow.

Powinien zawierac:

- raport miesieczny,
- raport roczny,
- podatek roczny,
- podatek narastajaco,
- zestawienie wplat i zaleglosci,
- zestawienie mediow,
- raport dla ksiegowego,
- eksport `XLSX`, `PDF` i `CSV`.

## Slownik pojec i mapowanie Excela

Importer Excela i UI musza stosowac nowe nazewnictwo.

| Pojecie w Excelu | Pojecie w aplikacji | Znaczenie |
| --- | --- | --- |
| `Marek` | `Zarządzanie Marek` | Koszt/kwota zwiazana z zarzadzaniem przez Marka. |
| `Dla mnie` | `Mój przychód` | Kwota zostajaca dla wlasciciela po rozliczeniach miesiecznych. |
| `Przelew` | `Przelew` | Kwota oczekiwana albo otrzymana od najemcy. |
| `czynsz` | `czynsz` | Domyslnie czesc opodatkowana. |
| `zaliczki na media` | `zaliczki na media` | Domyslnie czesc nieopodatkowana, ale konfigurowalna. |
| `Inne opłaty` | `Inne opłaty` | Kary, kaucje, doplaty i wyrownania; kazdy wpis moze miec wybor opodatkowania. |
| `Umowa do:` | `Umowa do` | Data konca umowy lub informacja o waznosci najmu. |
| `Zapłacone media` | `Zapłacone media` | Faktycznie poniesione koszty mediow w danym miesiacu. |
| `Zostało z mediów` | `Zostało z mediów` | Roznica miedzy zaliczkami pobranymi a mediami zaplaconymi. |
| `Podatek` | `Podatek` | Podatek miesieczny albo roczny z najmu. |
| `kościelna` | `kościelna` | Dodatkowy skladnik podatku/przychodu wystepujacy w obecnym Excelu. |

## Model rozliczen miesiecznych

Kazdy miesiac powinien miec wygenerowane naliczenia dla aktywnych najemcow. Naliczenie jest snapshotem danych z umowy i moze byc pozniej recznie skorygowane.

Minimalny model naliczenia:

- `property_id` - nieruchomosc,
- `unit_id` - pokoj/lokal,
- `tenant_id` - najemca,
- `lease_id` - umowa,
- `month` - miesiac w formacie `YYYY-MM`,
- `due_date` - termin platnosci,
- `expected_total` - oczekiwany przelew,
- `rent_amount` - czesc czynszowa,
- `utilities_advance` - zaliczka na media,
- `other_charges` - inne oplaty,
- `paid_amount` - faktycznie zaplacona kwota,
- `paid_at` - data wplaty,
- `payment_status` - status wplaty,
- `taxable_amount` - kwota opodatkowana,
- `tax_amount` - podatek miesieczny,
- `management_marek_amount` - `Zarządzanie Marek`,
- `owner_income_amount` - `Mój przychód`,
- `utilities_paid_amount` - zaplacone media,
- `utilities_balance_amount` - saldo mediow,
- `notes` - notatki.

Statusy platnosci:

- `unpaid` - brak wplaty,
- `partial` - czesciowa wplata,
- `paid` - zaplacone,
- `overpaid` - nadplata,
- `late` - po terminie.

## Widok roczny jak Excel

Widok `Rok` jest kluczowy, bo ma dac poczucie kontroli podobne do Excela, ale bez recznego przepisywania formul.

Zasady:

- wybrany rok jest glownym filtrem,
- wszystkie miesiace sa widoczne w jednym przewijanym widoku,
- miesiace moga byc sekcjami jedna pod druga albo w zwartej tabeli,
- tabela ma miec zamrozone etykiety miesiecy i najwazniejsze kolumny tam, gdzie technicznie bedzie to wygodne,
- sumy roczne i narastajace maja byc widoczne bez recznego liczenia,
- rozbieznosci maja byc oznaczone wizualnie,
- komorki z kwotami powinny byc edytowalne tam, gdzie ma to sens,
- dane historyczne nie powinny zmieniac sie przypadkowo po zmianie domyslnych kwot najemcy.

Przykladowe kolumny roczne:

- miesiac,
- najemca,
- termin,
- oczekiwany przelew,
- faktyczna wplata,
- status,
- czynsz opodatkowany,
- zaliczki na media,
- zaplacone media,
- zostalo z mediow,
- inne oplaty,
- `Zarządzanie Marek`,
- `Mój przychód`,
- podatek miesiaca,
- podatek narastajaco,
- zaleglosc/nadplata.

## Import wyciagow bankowych i Grok

Import bankowy ma byc deterministyczny tam, gdzie to mozliwe, i wspomagany przez LLM tylko przy niepewnych przypadkach.

### Parser lokalny

Backend powinien najpierw probowac sparsowac plik bez AI:

- wykryc format banku,
- wyciagnac transakcje,
- ujednolicic daty i kwoty,
- odrzucic duplikaty,
- oznaczyc transakcje przychodzace,
- porownac z oczekiwanymi wplatami.

### Reguly dopasowania

Dopasowanie powinno korzystac z:

- aliasow najemcy,
- kwoty oczekiwanej,
- miesiaca rozliczeniowego,
- daty przelewu wzgledem terminu,
- tytulu przelewu,
- numeru rachunku, jesli jest dostepny,
- historii poprzednich dopasowan.

### Grok / LLM

LLM moze dostac tylko minimalny zestaw danych potrzebnych do klasyfikacji, np. opis przelewu, kwote, date i liste mozliwych najemcow z aliasami.

Oczekiwany wynik powinien byc strict JSON, np.:

```json
{
  "tenantId": 1,
  "confidence": 0.86,
  "suggestedMonth": "2026-04",
  "amountType": "rent_payment",
  "reason": "Tytul przelewu zawiera alias najemcy i kwota pasuje do oczekiwanego przelewu."
}
```

Wynik LLM jest sugestia, nie decyzja. Uzytkownik zawsze zatwierdza ksiegowanie.

## Podatek i raporty

Kalkulator podatku ma byc konfigurowalny, ale domyslnie ustawiony pod najem prywatny na ryczalcie:

- 8,5% przychodu do 100 000 zl,
- 12,5% od nadwyzki ponad 100 000 zl,
- opcjonalny limit 200 000 zl dla malzonkow, ktorzy zlozyli oswiadczenie o opodatkowaniu przychodow przez jednego z nich.

Domyslne zasady opodatkowania:

- `czynsz` jest opodatkowany,
- `zaliczki na media` nie sa opodatkowane,
- `Inne opłaty` sa konfigurowalne per wpis,
- `kościelna` pozostaje osobnym konfigurowalnym skladnikiem, bo wystepuje w obecnym Excelu.

Raporty powinny zawierac:

- podatek miesieczny,
- podatek roczny,
- przychod narastajaco,
- prog podatkowy,
- liste skladnikow opodatkowanych,
- eksport dla ksiegowego,
- porownanie z importami bankowymi.

## Bezpieczenstwo danych

Modul bedzie przetwarzal dane finansowe i dane najemcow, wiec bezpieczenstwo jest czescia MVP.

Wymagania:

- klucz `XAI_API_KEY` tylko w zmiennych srodowiskowych albo sekretach serwera,
- brak kluczy API w frontendzie,
- minimalizacja danych wysylanych do Grok/LLM,
- walidacja uploadow po rozszerzeniu, rozmiarze i typie,
- przechowywanie uploadow poza statycznym webrootem,
- losowe nazwy plikow uploadowanych,
- domyslnie brak trwalego przechowywania oryginalnych wyciagow bankowych,
- zapis hasha pliku i wyekstrahowanych transakcji,
- CSRF token dla endpointow mutujacych,
- audyt zmian dla importow, dopasowan, recznych korekt, cofniec wplat i zmian umow,
- brak logowania pelnych danych bankowych w logach serwera,
- zachowanie obecnych backupow SQLite.

## Plan wdrozenia

### Etap 1 - dokumentacja i migracja domeny

- Utworzyc `README.md` z niniejszym planem.
- Zaprojektowac nowe tabele SQLite dla najmu.
- Dodac migracje z obecnych `tenantProfiles` i `tenantPaymentHistory`.
- Dodac warstwe API dla najmu.
- Zachowac kompatybilnosc z obecnym modulem do czasu przepiecia UI.

### Etap 2 - miesieczne rozliczenia

- Zbudowac widok `Miesiac`.
- Dodac generowanie miesiecznych naliczen z umow.
- Dodac edycje kwot i statusow.
- Dodac ksiegowanie i cofanie wplat.
- Spiac zatwierdzone wplaty z obecnymi `incomeEntries` i saldem Budget App.

### Etap 3 - widok roczny

- Zbudowac widok `Rok` jako przewijany arkusz.
- Dodac roczne sumy i narastajacy podatek.
- Dodac oznaczanie zaleglosci, nadplat i rozbieznosci.
- Zweryfikowac layout na desktopie i mobile.

### Etap 4 - importer Excela

- Dodac parser `ROZLICZENIA Z NAJEMCAMI.xlsx`.
- Rozpoznawac arkusze roczne i miesieczne bloki.
- Mapowac stare etykiety na nowe.
- Importowac historie jako snapshoty.
- Dodac raport importu: zaimportowane miesiace, pominiete wiersze, ostrzezenia.

### Etap 5 - import banku

- Dodac upload `CSV/XLSX/PDF`.
- Dodac parser transakcji.
- Dodac deduplikacje.
- Dodac sugestie dopasowan.
- Dodac ekran zatwierdzania sugestii.
- Dodac audyt importow i decyzji uzytkownika.

### Etap 6 - Grok / LLM

- Dodac backendowy klient xAI.
- Dodac strict JSON schema dla sugestii dopasowania.
- Wysylac do LLM tylko niepewne transakcje.
- Dodac fallback bez AI, gdy brak klucza API albo API jest niedostepne.

### Etap 7 - raporty i eksporty

- Dodac raport podatkowy miesieczny i roczny.
- Dodac eksport `XLSX`, `PDF`, `CSV`.
- Dodac raport dla ksiegowego.
- Dodac porownanie oczekiwanych i faktycznych przelewow.

### Etap 8 - utwardzenie i regresja

- Dodac testy jednostkowe i E2E.
- Sprawdzic backupy, auth, saldo, wplywy i wydatki.
- Sprawdzic bezpieczenstwo uploadow.
- Zweryfikowac layout modulu najmu.

## Testy akceptacyjne

- Import Excela rozpoznaje arkusze roczne i miesieczne bloki.
- Import Excela mapuje `Marek` na `Zarządzanie Marek`.
- Import Excela mapuje `Dla mnie` na `Mój przychód`.
- Widok `Miesiac` pozwala edytowac kwoty, oznaczyc wplate, cofnac wplate i zachowac snapshot historyczny.
- Widok `Rok` pokazuje przewijany arkusz wszystkich miesiecy wybranego roku.
- Widok `Rok` nie rozjezdza kolumn na desktopie i mobile.
- Podatek jest liczony miesiecznie i rocznie.
- Podatek obsluguje progi 8,5% i 12,5%.
- Podatek obsluguje wariant limitu malzenskiego 200 000 zl.
- Import bankowy obsluguje `CSV`, `XLSX` i `PDF`.
- Import bankowy deduplikuje transakcje.
- Import bankowy proponuje dopasowania do najemcow.
- Import bankowy wymaga zatwierdzenia przed ksiegowaniem.
- Grok/LLM zwraca sugestie w strict JSON i nie ksieguje samodzielnie.
- Audyt zapisuje importy, zatwierdzenia, odrzucenia i cofniecia.
- Regresja Budget App przechodzi: saldo, wplywy, wydatki, backupy, logowanie i obecne testy nadal dzialaja.

## Zalozenia i zrodla

- MVP dziala jako modul obecnej Budget App na Proxmox. Railway nie jest srodowiskiem docelowym.
- W pierwszej wersji nie ma panelu dla najemcow.
- W pierwszej wersji nie ma automatycznych platnosci online.
- Pelna integracja bankowa PSD2/open banking nie jest czescia MVP.
- Grok/LLM jest dodatkiem pomocniczym, a nie zrodlem prawdy ksiegowej.
- Aplikacja nie zastepuje porady ksiegowej; reguly podatkowe musza byc konfigurowalne.

Zrodla funkcjonalne i techniczne:

- [Landlord Studio - rental accounting](https://www.landlordstudio.com/features/rental-accounting)
- [Landlord Studio - online rent collection](https://www.landlordstudio.com/features/online-rent-collection)
- [Baselane - landlord accounting](https://www.baselane.com/landlord-accounting)
- [Stessa](https://www.stessa.com/)
- [podatki.gov.pl - dochody z najmu](https://www.podatki.gov.pl/podatki-osobiste/pit/informacje-podstawowe/co-jest-opodatkowane/dochody-z-najmu/)
- [xAI docs](https://docs.x.ai/overview)
- [xAI structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
- [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP Protect Data Everywhere](https://devguide.owasp.org/en/04-design/02-web-app-checklist/08-protect-data/)
