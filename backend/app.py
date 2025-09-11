# Stand: 11.09.2025, Weindok

import os
import requests
import re
from flask_cors import CORS
from flask import request, jsonify, Flask
from openai import OpenAI
from dotenv import load_dotenv


# .env-Datei laden (nur im lokalen Dev-Setup nötig)
load_dotenv()

# API-Keys aus Umgebungsvariablen lesen
openai_api_key = os.getenv("OPENAI_API_KEY")
elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")

# API-Clients initialisieren
client = OpenAI(api_key=openai_api_key)
ELEVENLABS_API_KEY = elevenlabs_api_key
  
app = Flask(__name__)
CORS(app)

# Backend-Test
@app.route('/api/ping', methods=['GET'])
def ping():
    return "Verbindung zum Backend erfolgreich!"


# Route zum Erhalt der aktuellen Lokation
@app.route("/api/location_name")
def location_name():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Koordinaten fehlen"}), 400

    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=14&addressdetails=1"
        headers = {
            "User-Agent": "KI-Audioguide-Prototyp"
        }
        response = requests.get(url, headers=headers)
        data = response.json()

        ort = data.get("address", {}).get("city") or \
              data.get("address", {}).get("town") or \
              data.get("address", {}).get("village") or \
              data.get("address", {}).get("suburb") or \
              "Unbekannter Ort"

        return jsonify({"ort": ort})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
# @app.route("/api/location_name") - END


# POI-Filterung im Umkreis über OpenStreetMap
@app.route('/api/poi', methods=['POST'])
def finde_pois():
    daten = request.get_json()
    lat = daten.get("lat")
    lon = daten.get("lon")

    if not lat or not lon:
        return jsonify({"error": "Ungültige Koordinaten"}), 400

    overpass_url = "https://overpass-api.de/api/interpreter"
    radius = 100  # Suchradius in Meter

    # TAG-Filtereinstellungen für relevante POIs
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
        response = requests.post(overpass_url, data={"data": query})
        pois = response.json().get("elements", [])
        return jsonify({"pois": pois})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
# @app.route('/api/poi', methods=['POST']) - END


# Informationsgenerierung zum POI über ChatGPT
@app.route("/api/poi-info", methods=["POST"])
def poi_info():
    data = request.get_json(force=True)
    prompt = data.get("prompt")
    if not prompt:
        return jsonify({"error": "Prompt fehlt"}), 400

    try:
        # Responses API + Websuche aktiviert
        resp = client.responses.create(
            model = "gpt-4o-mini",                # KI-Modell
            temperature = 0.2,                    # beeinflusst Qualität der Antworten
            max_output_tokens = 350,              # Begrenzung der Generierung
            tools=[{"type": "web_search"}],       # Browsing erlauben
            input=[
                {
                    "role": "system",
                    "content": (
                        "Du bist faktenstreng. Nutze Websuche. "
                        "Wenn keine belastbaren Quellen gefunden werden: Antworte mit 'Ich kann hierzu leider keine verlässlichen Informationen geben'. "
                        "Gib reinen Fließtext aus. Keine Markdown-Formatierung (keine Überschriften, Listen, Fettschrift), keine Links/URLs, keine Klammern mit Quellenangaben. Maximal 4 Sätze."
                        "Fasse dich präzise."
                    )
                },
                {"role": "user", "content": prompt}
            ],
        )

        # KI-Antwort filtern 
        text = clean_answer(resp.output_text.strip())
        return jsonify({"text": text, "prompt": prompt})

    except Exception as e:
        print("❌ API-Fehler:", e)
        return jsonify({"error": str(e)}), 500
# @app.route("/api/poi-info", methods=["POST"]) - END


# Route zur Sprachgenerierung mittels ELEVENLABS
@app.route("/api/tts", methods=["POST"])
def tts():
    data = request.get_json()
    text = data.get("text")

    if not text:
        return jsonify({"error": "Kein Text übergeben"}), 400

    try:
        response = requests.post(
            "https://api.elevenlabs.io/v1/text-to-speech/eEmoQJhC4SAEQpCINUov" ,  # Standard-Stimme: "Der Toby"
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json"
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75
                }
            }
        )

        if response.status_code != 200:
            print("ElevenLabs API-Fehler:", response.status_code)
            print(response.text)
            return jsonify({"error": "Fehler bei ElevenLabs"}), 500

        # MP3 als Byte-Stream zurückgeben
        return response.content, 200, {
            "Content-Type": "audio/mpeg"
        }

    except Exception as e:
        print("TTS-Fehler:", e)
        return jsonify({"error": str(e)}), 500
# @app.route("/api/tts", methods=["POST"]) - END


# ermöglicht Dialog im gleichen Chat – mit Responses API + Websuche
@app.route("/api/poi-dialog", methods=["POST"])
def poi_dialog():
    data = request.get_json(force=True)
    messages = data.get("messages", [])

     # für TEST
    print("🧾 Übergebener Verlauf:")
    for i, msg in enumerate(messages):
        print(f"{i+1}. {msg['role'].upper()}: {msg['content']}")

    # System-Prompt vorn einfügen (falls Client keinen mitliefert)
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

    try:
        # Responses API mit Websuche
        resp = client.responses.create(
            model = "gpt-4o-mini",             # KI-Modell
            temperature = 0.2,                 # beeinflusst Qualität der Antworten
            tools = [{"type": "web_search"}],  # Browsing erlauben
            input = messages                   # Verlauf übergeben
        )

        # Text entnehmen und säubern
        text = resp.output_text.strip()
        text = clean_answer(text)

        return jsonify({"text": text})

    except Exception as e:
        print("❌ API-Fehler:", e)
        return jsonify({"text": "Fehler bei der KI-Antwort."}), 500
# @app.route("/api/poi-dialog", methods=["POST"]) - END


# Funktion zur Filterung der KI-Antwort
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

    return s



# Start der Routine
if __name__ == '__main__':
    print("Flask startet...")
    app.run(debug=True)
