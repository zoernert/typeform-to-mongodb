Aufgabe ist es ein Node JS Script zu erstellen, welches alle Antworten, die auf Typeform vorhanden sind für alle Fragebögen in eine Mongo DB Collection schreibt. Jedes Dokument in der Collection ist eine einzelne Antwort. In der .env ist der API Schlüssel für Typeform vorhanden sowie die Verbindungsdetails für die Mongo DB.

Beispiel für einen Eintrag in der Collection (eine Antwort):
{
  "id": "o4Sdlq5K_undefined_zw8pkxckpsrtl44gizw8pkef6c5wusz5_minjana@web.de",
  "antwort": "Malen, Karate",
  "chiffre": null,
  "datum": "2025-08-29",
  "email": "minjana@web.de",
  "field_id": "mmYYw9WFugv2",
  "form_id": "o4Sdlq5K",
  "frage": "Was bereitet Ihnen aktuell am meisten *Freude* im Leben?",
  "idx": 25,
  "response_id": "zw8pkxckpsrtl44gizw8pkef6c5wusz5"
}

Plan:
1. Abrufen aller vorhandenen Formulare von Typeform:
    API-Endpunkt: https://api.typeform.com/forms?page={{ $page }}
    Hinweis: Beachte dass wir Pagination verstehen müssen. Nutze hierfür in der Antwort das Feld "page_count".
    In der Antwort sind alle Formulare gelistet im Array Items. Wir benötigen aus dem Items Object das Feld "id". Merke die "id" als "form_id". 

2. Rufe für jedes Formular auf Basis der "form_id" folgenden API-Endpunkt auf, um die Struktur (Felder, Definitionen) des Formulars zu erhalten.
    API-Endpunkt: https://api.typeform.com/forms/{{ $form_id }}
    Hinweis: Wir benötigen den Array "fields". Der Wert in "title" gibt unsere Frage und wird in "frage" gespeichert. 
    Der Wert in "id" wird als "field_id" gespeichert.

3. Rufe nun die Antworten für jedes Formular ab.
    API-Endpunkt: https://api.typeform.com/forms/{{ $form_id }}/responses?page={{ $page }}
    Hinweis: Beachte dass wir Pagination verstehen müssen. Nutze hierfür in der Antwort das Feld "page_count".

4. Baue den Eintrag für die MongoDB Collection.
   Gehe zunächst alle Antworten durch. Wenn ein Antwort eine Email enthält, dann merke Dir dies als "email".
   Wenn ein Feld eine Chriffre enthält ( Regex: /^\d{5}[A-Za-z]{1}\d{8}$/; ), dann merke Dir dies als "chiffre".
   Felder des Eintrags:
   {
    "id": "{{form_id}}_{{chiffre||email}}_{{response_id}}_{{email}}",
    "antwort": {{antwort}},
    "chiffre": {{chiffre}},
    "datum": {{datum der Antwort. Beispiel: "2025-08-29"}},
    "email": "{{email}},
    "field_id": {{field_id}},
    "form_id": {{form_id}},
    "frage": {{frage}},
    "idx": {{Index der Antwort in der Response (Zähler)}},
    "response_id": {{response_id}}
  }
  Bei Multiple Choice Feldern gib das Label anstelle des Wertes als Antwort aus.
  
5. Speichere den Eintrag in der MongoDB Collection mit einem Upsert.