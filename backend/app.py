# Stand: 11.09.2025, Weindok

import os
import requests
import re
from flask_cors import CORS
from flask import request, jsonify, Flask
from openai import OpenAI
from dotenv import load_dotenv


# .env-Datei laden
load_dotenv()

# -------------------------------------------------------------
# GLOBALE VARIABLEN UND KONSTANTEN:

# API-Keys aus .env Datei lesen
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# OpenAI-API-Client initialisieren
client = OpenAI(api_key=OPENAI_API_KEY)

# URL für API von OpenStreetMap
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Flask-App erzeugen; __name__ hilft beim Auffinden von Ressourcen & Debug-Reload
app = Flask(__name__)
# CORS aktivieren: erlaubt dem Frontend API-Aufrufe im Browser
CORS(app)


# -------------------------------------------------------------
# FUNKTIONEN:


# def ping() - Route für den Backend-Test
@app.route('/api/ping', methods=['GET'])
def ping():
    return "Verbindung zum Backend erfolgreich!"
# END def ping() 


# def location_name() - Route zum Erhalt der aktuellen Lokation über Nominatim API von OpenStreetMap
@app.route("/api/location_name")
def location_name():
    # Initalisierung des Längen- und Breitengrads über GPS
    lat = request.args.get("lat")
    lon = request.args.get("lon")

    # Fehlerbehandlung falls Längen- und/oder Breitengrad nicht laden
    if not lat or not lon:
        return jsonify({"error": "Koordinaten fehlen"}), 400

    # Aufruf der Nominatim-API mit den Längen- und Breitengraden
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=14&addressdetails=1"
        headers = {
            "User-Agent": "KI-Audioguide-Prototyp"
        }
        response = requests.get(url, headers=headers)
        data = response.json()

        # Initialisierung des Ortes gemäß Koordinaten anhand OSM-Tags
        ort = data.get("address", {}).get("city") or \
              data.get("address", {}).get("town") or \
              data.get("address", {}).get("village") or \
              data.get("address", {}).get("suburb") or \
              "Unbekannter Ort"

        # Rückgabe Ort      
        return jsonify({"ort": ort})
    
    #Fehlerbehandlung falls API nicht aufrufbar
    except Exception as e:
        return jsonify({"error": str(e)}), 500
# END- def location_name()


# def finde_pois() - Route zur POI-Filterung im Umkreis über OpenStreetMap 
# es wird eine Liste mit POIs  als Button angezeigt um weitere Inforamtionen zu generieren 
@app.route('/api/poi', methods=['POST'])
def finde_pois():
    # Suchradius in Meter
    radius = 100  

    # Initalisierung des Längen- und Breitengrads über GPS
    daten = request.get_json()
    lat = daten.get("lat")
    lon = daten.get("lon")

    # Fehlerbehandlung falls Koordinaten nicht abrufbar
    if not lat or not lon:
        return jsonify({"error": "Ungültige Koordinaten"}), 400


    # Filterung für die POI-Liste: alles mit OSM-Tag: tourism=attraction, tourism=artwork, historic oder heritage=1
    # suchen node/way/relation, damit auch Flächen/Relationen kommen
    query = f"""
    [out:json];
    (
      node(around:{radius},{lat},{lon})[tourism=attraction];
      way(around:{radius},{lat},{lon})[tourism=attraction];
      relation(around:{radius},{lat},{lon})[tourism=attraction];

      node(around:{radius},{lat},{lon})[tourism=artwork];
      way(around:{radius},{lat},{lon})[tourism=artwork];
      relation(around:{radius},{lat},{lon})[tourism=artwork];

      node(around:{radius},{lat},{lon})[historic];
      way(around:{radius},{lat},{lon})[historic];
      relation(around:{radius},{lat},{lon})[historic];

      node(around:{radius},{lat},{lon})[heritage=1];
      way(around:{radius},{lat},{lon})[heritage=1];
      relation(around:{radius},{lat},{lon})[heritage=1];
    );
    out center;
    """

    try:
        # API-Call um POI-Liste zu erhalten
        response = requests.post(OVERPASS_URL, data={"data": query})
        pois = response.json().get("elements", [])

        # Rückgabe des Query mit den POIs
        return jsonify({"pois": pois})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
# END def finde_pois()


# def poi_info() - Route zur Informationsgenerierung zum POI über OpenAI-API -> ChatGPT
@app.route("/api/poi-info", methods=["POST"])
def poi_info():
    # request = Flask-Request-Objekt, JSON immer parsen, auch wenn der Client keinen "Content-Type: application/json" setzt
    data = request.get_json(force=True)

    # Übergabe Prompt aus script.js
    prompt = data.get("prompt")

    # Fehlerbehandlung falls kein Prompt vorhanden 
    if not prompt:
        return jsonify({"error": "Prompt fehlt"}), 400

    # OpenAI-API Aufruf 
    try:
        # Responses API + Websuche aktiviert
        resp = client.responses.create(
            model = "gpt-4o-mini",                # Modellauswahl
            temperature = 0.2,                    # bestimmt die Genauigkeit der Aussagen (zwischen 1.0 - 0.0)
            max_output_tokens = 350,              # Limitierung der Tokens um keine zu großen Antworten zu erhalten 
            tools=[{"type": "web_search"}],       # Web-Suche erlauben 
            input=[
                {
                    "role": "system",
                    # Content spezifiziert die Art des Outputs
                    "content": (
                        "Du bist faktenstreng. Nutze Websuche. "
                        "Wenn keine belastbaren Quellen gefunden werden: Antworte mit 'Ich kann hierzu leider keine verlässlichen Informationen geben'. "
                        "Gib reinen Fließtext aus. Keine Markdown-Formatierung (keine Überschriften, Listen, Fettschrift), keine Links/URLs, keine Klammern mit Quellenangaben. Maximal 4 Sätze."
                        "Fasse dich präzise."
                    )
                },
                {"role": "user", "content": prompt}     # Übergabe Prompt
            ],
        )

        # Antwort filtern um URLs etc. die für die Audioausgabe hinderlich sind zu entfernen
        text = clean_answer(resp.output_text.strip())

        # Rückgabe des Prompts (wichtig für Dialogführung) und der Antwort 
        return jsonify({"text": text, "prompt": prompt})

    # Fehlerbehandlung falls API nicht erreichbar
    except Exception as e:
        print("❌ API-Fehler:", e)
        return jsonify({"error": str(e)}), 500
# END - def poi_info()


# def tts() - Route zur Sprachgenerierung mittels ELEVENLABS-API
@app.route("/api/tts", methods=["POST"])
def tts():
    # JSON parsen, wenn  Client korrekt "Content-Type: application/json" sendet
    data = request.get_json()

    # Übergabe des Infotextes aus script.js
    text = data.get("text")

    # Fehlerbehandlungen für text
    if not text:
        return jsonify({"error": "Kein Text übergeben"}), 400

    # ELEVENLABS-API Aufruf
    try:
        response = requests.post(
            "https://api.elevenlabs.io/v1/text-to-speech/eEmoQJhC4SAEQpCINUov" ,    # API-Aufruf, Standard-Stimme: "Der Toby"
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,                                   # API-Key 
                "Content-Type": "application/json"
            },
            json={
                "text": text,                                                       # Test welcher vertont werden soll
                "model_id": "eleven_multilingual_v2",                               # Sprachmodell: multilingual wichtig für Akzentfrei
                "voice_settings": {                                                 # Modelleinstellungen:
                    "stability": 0.5,                                               # ausgeglichenen Sprachstabilität (Wert zwischen 1 - 0)
                    "similarity_boost": 0.75                                        # wie stark die Ausgabe an Stimmidentität des Vorbilds klingt
                }
            }
        )

        # Fehlerbehandlung wenn Status-Code nicht 200
        if response.status_code != 200:
            print("ElevenLabs API-Fehler:", response.status_code)
            print(response.text)
            return jsonify({"error": "Fehler bei ElevenLabs"}), 500

        # Audio direkt zurückgeben
        return response.content, 200, {
            "Content-Type": "audio/mpeg"
        }

    # Fehlerbehandlung bei fehlerhaftem API-Aufruf
    except Exception as e:
        print("TTS-Fehler:", e)
        return jsonify({"error": str(e)}), 500
# END def tts()


# def poi_dialog() - Route um Dialog im gleichen Chat zu ermöglichen – mit Responses API + Websuche
@app.route("/api/poi-dialog", methods=["POST"])
def poi_dialog():
    # request = Flask-Request-Objekt, JSON immer parsen, auch wenn der Client keinen "Content-Type: application/json" setzt
    data = request.get_json(force=True)

    # Übergabe des gesamten Dialogverlaufs
    messages = data.get("messages", [])

    # Hilfe für Debuggen
    print("🧾 Übergebener Verlauf:")
    for i, msg in enumerate(messages):
        print(f"{i+1}. {msg['role'].upper()}: {msg['content']}")

    # System-Prompt vorn einfügen falls nicht vorhanden
    system_msg = {
        "role": "system",
        "content": (
            "Du bist faktenstreng und nutzt bei Bedarf Websuche. "
            "Wenn keine belastbaren Informationen gefunden werden: Antworte mit 'Ich kann dir leider keine verlässliche Information hierzu geben'. "
            "Antworte auf Deutsch, sachlich, kurz und ohne Markdown/Links/Quellenangaben."
        )
    }
    if not messages or messages[0].get("role") != "system":
        messages = [system_msg] + messages

    # Verlauf einkürzen (einfaches Trimming – spart Tokens)
    MAX_TURNS = 12  # Anzahl der letzte Nachrichten die übergeben werden
    if len(messages) > MAX_TURNS:
        # behalte System + die letzten (MAX_TURNS-1) Messages
        messages = [messages[0]] + messages[-(MAX_TURNS-1):]

    # OpenAI-API Aufruf
    try:
        # Responses API mit Websuche
        resp = client.responses.create(
            model = "gpt-4o-mini",             # KI-Modell
            temperature = 0.2,                 # beeinflusst Qualität der Antworten
            tools = [{"type": "web_search"}],  # Browsing erlauben
            input = messages                   # Verlauf übergeben
        )

        # Text entnehmen und filtern
        text = resp.output_text.strip()
        text = clean_answer(text)

        # Rückgabe der Antwort
        return jsonify({"text": text})

    # Fehlerbehandlung fals API nicht verfügbar
    except Exception as e:
        print("❌ API-Fehler:", e)
        return jsonify({"text": "Fehler bei der KI-Antwort."}), 500
# END - def poi_dialog()


# def clean_answer - Funktion zur Filterung der KI-Antwort für sauberen Output und Audioausgabe
def clean_answer(text: str) -> str:
    s = text.strip()

    # Markdown-Headings am Zeilenanfang entfernen
    s = re.sub(r'(?m)^\s{0,3}#{1,6}\s+.*\n?', '', s)

    # Markdown-Links [Text](URL) entfernen
    s = re.sub(r'\[([^\]]+)\]\((?:[^)]+)\)', r'\1', s)

    # Inline-URLs entfernen
    s = re.sub(r'https?://\S+|www\.\S+', '', s)

    # Klammern mit typischen Quellenhinweisen entfernen
    s = re.sub(r'\s*\((?:[^)]*(?:quelle|sources?|wikipedia|wikidata|doi|wiki|\.org|\.de|http)[^)]*)\)\.?', '', s, flags=re.IGNORECASE)

    # Lose eckige/runde Klammern am Ende abschneiden
    s = re.sub(r'[\s\[\]()]+$', '', s)

    # Mehrfache Leerzeichen/Leerzeilen glätten
    s = re.sub(r'\s{2,}', ' ', s).strip()

    # Punkt am Ende sicherstellen
    if s and s[-1] not in '.!?':
        s += '.'

    # Rückgabe der gefilterten Antwort
    return s
# END - def clean_answer()


# -------------------------------------------------------------
# START DER ROUTINE:
if __name__ == '__main__':
    print("Flask startet...")
    app.run(debug=True)
