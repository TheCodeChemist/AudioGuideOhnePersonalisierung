// Stand 11.09.2025, Weindok

let aktuellerOrt = "Unbekannt";
let aktuellerPOIKey = null;
let chatThreads = {}; // Objekt: { 'POI-Name|Ort': [ {role: ..., content: ...}, ... ] }
let letzteGPTAntwort = ""; 




// Funktionen ins globale `window`-Objekt "exportieren":
// Dadurch können sie auch direkt aus dem HTML heraus aufgerufen werden,
// oder über die Browser-Konsole. Ohne diese Zuweisung wären sie
// außerhalb dieses Skripts nicht zugreifbar.
window.sendeFrage = sendeFrage;
window.zeigeFrageEingabe = zeigeFrageEingabe;
window.schließePOI = schließePOI;



// Test für Frontend-Backend-Verbindung
document.getElementById("pingButton").addEventListener("click", () => {
    fetch("http://localhost:5000/api/ping")
      .then((res) => res.text())
      .then((data) => {
        document.getElementById("responseOutput").textContent = data;
      })
      .catch((err) => {
        document.getElementById("responseOutput").textContent = "Fehler: " + err;
      });
    })
// END -  document.getElementById("pingButton")


// berechnet Entfernung zu POI
function berechneEntfernungMeter(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Erd-Radius in Meter
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}
// END - function berechneEntfernungMeter
  

// Anzeigen/Updates der POIs in der Nähe starten, sobald alles geladen ist
window.addEventListener("load", () => {
  // Prüfen, ob der Brwoser die Geolocation-API unterstützt
  if ("geolocation" in navigator) {
    document.getElementById("gpsStatus").textContent = "GPS-Tracking aktiv …";
  
    // Variablen deklarieren da keine globalen Variablen
    let aktuelleLat = null;
    let aktuelleLon = null;
      
    navigator.geolocation.watchPosition(
      (position) => {
          // Koordinaten auf 6. Stelle runden
          const lat = position.coords.latitude.toFixed(6);
          const lon = position.coords.longitude.toFixed(6);

          // Globale numerische Koordinaten für weitere Berechnungen setzen
          aktuelleLat = parseFloat(lat);
          aktuelleLon = parseFloat(lon);
          const liste = document.getElementById("poiListe");
          liste.innerHTML = "";
          // let gefiltertePOIs = [];
            

          // Koordinaten im UI anzeigen
          document.getElementById("liveCoords").textContent =
            `Breitengrad: ${lat} | Längengrad: ${lon}`;
          

          // Ort von Backend ermitteln lassen 
          fetch(`http://localhost:5000/api/location_name?lat=${aktuelleLat}&lon=${aktuelleLon}`)
            .then(res => res.json())
            .then(data => {
              // ermittelten Ort übernehmen, Fallback auf Unbekannt
              aktuellerOrt = data.ort || "Unbekannt";
              document.getElementById("ortAnzeige").textContent = `📍 Aktueller Ort: ${data.ort}`;
            })
            .catch(err => {
            console.error("Fehler beim Abrufen des Ortsnamens:", err);
          });

          // POI-Abfrage an Backend senden
          fetch("http://localhost:5000/api/poi", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ lat: lat, lon: lon }),
          })
          .then((res) => res.json())
          .then((data) => {
            // Liste mit POIs
            const pois = data.pois;

            // POI-Liste als klickbare Buttons rendern
            const liste = document.getElementById("poiListe");  
            liste.innerHTML = ""; 

            if (pois && pois.length > 0) {
              let gefiltertePOIs = [];
            
              pois.forEach((poi) => {
                const name = poi.tags?.name;
                if (!name) return;  // nur Einträge mit Namen
            
                // Typ (nur für Prompt), Koordinaten aus node/way/relation ziehen
                const typ = poi.tags?.tourism || poi.tags?.historic || poi.tags?.amenity || "unbekannt";
                const plat = poi.lat || poi.center?.lat;
                const plon = poi.lon || poi.center?.lon;
                if (!plat || !plon || !aktuelleLat || !aktuelleLon) return;
            
                // Entfernung zum nutzer berechnen und zwischenspeichern
                const distanz = berechneEntfernungMeter(aktuelleLat, aktuelleLon, plat, plon);
                gefiltertePOIs.push({ name, typ, distanz, tags: poi.tags });
              });
            
              // gefundende POIs nach Entfernung sortieren 
              gefiltertePOIs.sort((a, b) => a.distanz - b.distanz);
          
              if (gefiltertePOIs.length > 0) {
                // Für jeden POI einen Button erzeugen der bei Klick Infos generiert
                gefiltertePOIs.forEach((poi) => {
                  const eintrag = document.createElement("li");
                  const button = document.createElement("button");
                  button.textContent = `${poi.name} – ${poi.distanz} m`;
                  button.classList.add("poi-button");
                  button.addEventListener("click", () => {
                    ladePOIInfo(poi); 
                  });
                  eintrag.appendChild(button);
                  liste.appendChild(eintrag);
                });
                
                // Statuszeile anpassen
                document.getElementById("gpsStatus").textContent =
                  `📍 ${gefiltertePOIs.length} POI${gefiltertePOIs.length === 1 ? '' : 's'} in deiner Nähe`;
              } else {
                // keine POIs in der Nähe
                document.getElementById("gpsStatus").textContent = "Kein POI in der Nähe.";
                liste.innerHTML = "<li>Keine Ergebnisse.</li>";
              }
            } else {
              // keine POIs in der Nähe
              document.getElementById("gpsStatus").textContent = "Kein POI in der Nähe.";
              liste.innerHTML = "<li>Keine Ergebnisse.</li>";
            }
          })
          .catch((err) => {
            // Fehlerbehandlung bei Ladefehler von POI
            console.error("Fehler bei POI-Abfrage:", err);
          });
      },
      // Fehlercallback der Geolocation 
      (error) => {
        document.getElementById("gpsStatus").textContent = "Fehler beim GPS-Tracking.";
        console.error("GPS-Fehler:", error);
      },
      {
        // Optionen für Tracking
        enableHighAccuracy: true, // GPS mit höherer Genauigkeit
        maximumAge: 0,            // keine gecachten Positionen verwenden
        timeout: 10000            // max. 10s auf einen Fix warten
      }
    );
  } else {
    // Geolocation steht nicht zur Verfügung 
    document.getElementById("gpsStatus").textContent = "Geolocation nicht unterstützt.";
  }
});
// END - window.addEventListener("load")


/** Erstellt aus einem OSM-POI einen kurzen Prompt,
 * ruft das Backend für einen Info-Text auf
 * und rendert den Dialogbereich inkl. Aktionen (Mehr Infos, Frage, Vorlesen). */
function ladePOIInfo(poi) {
  // Variablen
  const name = poi.name;          // POI-Name
  const tags = poi.tags || {};    // OSM Tags
  let typ = "Ort";                // Art des POIs
  
  // Priorisierte Tag-Auswertung für Prompt
  if (tags.tourism === "attraction") {
    typ = "Sehenswürdigkeit";
  } else if (tags.tourism === "artwork") {
    typ = "Kunstwerk";
  } else if (tags.heritage) {
    typ = "Kulturerbe";
  } else if (tags.historic === "memorial") {
    if (tags.memorial) {
      typ = `${tags.memorial}`;
    } else {
      typ = "Memorial";
    }
  } else if (tags.historic === "yes" || tags.historic === "benutzerdefiniert") {
      typ = "";
  } else if (tags.historic) {
    typ = `${tags.historic}`;
  }
  
  // Prompt für POI zusammenstellen
  const prompt = `Gib mir einen Informationstext zu ${typ} "${name}" in ${aktuellerOrt} von max 4 Sätzen, der in einem Audioguide genutzt werden kann`;

  // Testweise in Konsole anzeigen
  console.log("📤 Generierter Prompt:", prompt);
  
  // Textbereich vorbereiten
  const antwortBereich = document.getElementById("antwortBereich");

  // Anzeige solange Antwort lädt
  antwortBereich.innerHTML = "<p>⏳ Informationen werden geladen …</p>";

  // schickt  Prompt an das  Backend und erwartet POI-Infos als JSON
  fetch("http://localhost:5000/api/poi-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(res => res.json())
    .then(data => {
      // Key für Dialogfunktion erstellen um Kontext im Dialog zu wahren
      if (data.text) {
          aktuellerPOIKey = `${poi.name}|${aktuellerOrt}`; 
          chatThreads[aktuellerPOIKey] = [
              { role: "user", content: data.prompt },
              { role: "assistant", content: data.text }
            ];
            letzteGPTAntwort = data.text;
            document.getElementById("poiListeWrapper").style.display = "none";

            // dynamisches HTML, wird angezeigt, wenn POI Info erzeugt und angezeigt wird
            antwortBereich.innerHTML = `
              <h3>${name}</h3>
              <div id="chatContainer">
                <div id="chatVerlauf">
                  <p><strong>Antwort:</strong> ${data.text}</p>
                </div>
                <button id="vorlesenBtn">🔊 Vorlesen</button>
                <button onclick="sendeMehrInfos()">📘 Mehr Informationen</button>
                <button onclick="zeigeFrageEingabe()">❓ Frage stellen</button>
                <button onclick="schließePOI()">🛑 POI abschließen</button>
              </div>
              <div id="frageEingabe" style="display:none;">
                <input type="text" id="nutzerFrage" placeholder="Deine Frage zum POI" />
                <button onclick="sendeFrage()">Senden</button>
                <button onclick="abbrechenFrage()">Abbrechen</button>
                <button onclick="sprichFrage()">🎙️ Sprechen</button>
                <p id="frageFehler" style="color: red; font-size: 0.9em; display: none; margin-top: 5px;"></p>
              </div>
            `; 

            // Infotext nochmals filtern für saubere Audioausgabe
            document.getElementById("vorlesenBtn").addEventListener("click", () => {
              const safe = letzteGPTAntwort.replace(/["']/g, "");
              
              // Consolen Log für Debuggen
              console.log(safe);

              // Funktionsaufruf um ElevenLabs API aufzurufen und die Audio zu generieren
              spieleTTS(safe);
            });
      } else {
        // Fehlerbehandlung falls API-Probleme
        antwortBereich.innerHTML = "<p>⚠️ Es gab ein Problem bei der Antwort.</p>";
      }
    })
    .catch(err => {
      // Fehlerbehandlung falls API-Probleme
      console.error("Fehler bei GPT-Antwort:", err);
      antwortBereich.innerHTML = "<p>⚠️ Fehler beim Laden der Information.</p>";
    });
}
// END - function ladePOIInfo()
  

/** Spielt per Text-to-Speech generiertes Audio für den gegebenen Text ab.
 * Ablauf:
 *  1) Schickt den Text als JSON an das TTS-Backend.
 *  2) Erwartet einen Audio-Blob als Antwort.
 *  3) Erzeugt daraus eine temporäre URL und spielt sie über ein <audio>- */
function spieleTTS(text) {
  // schickt Text an das Backend und erwartet Audio
  fetch("http://localhost:5000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text })
  })
    .then(res => {
      // Fehlerbehandlung falls HTTP-Problem
      if (!res.ok) throw new Error("Audio konnte nicht geladen werden");
      return res.blob();
    })
    .then(blob => {
      // Aus Blob eine temporäre URL erzeugen, die Audio abspielen kann
      const audioUrl = URL.createObjectURL(blob);

      // Audioelement erstellen und abspielen
      const audio = new Audio(audioUrl);
      audio.play();
    })
    .catch(err => {
      // Netz-, Parsing- oder Serverfehler landen hier
      console.error("TTS-Fehler:", err);
    });
}
// function spieleTTS - END


// Blendet das Eingabe-Panel für Nutzerfragen ein
function zeigeFrageEingabe() {
  document.getElementById("frageEingabe").style.display = "block";
}
// END - function zeigeFrageEingabe()



/** Schließt den POI-Dialog:
 *  - leert den Antwortbereich,
 *  - zeigt die POI-Liste wieder an,
 *  - setzt den aktuellen Chat-Kontext zurück. */
function schließePOI() {
  // Antworten im Dialogbereich entfernen
  document.getElementById("antwortBereich").innerHTML = "";

  // Wrapper mit der POI-Liste wieder einblenden
  document.getElementById("poiListeWrapper").style.display = "block";

  // Chat-Kontext zurücksetzen
  aktuellerPOIKey = null;
  letzteGPTAntwort = "";
}
// END - function schließePOI()


/**
 * Liest die Nutzerfrage aus dem Eingabefeld, validiert sie,
 * hängt sie an den Chat-Verlauf an, sendet sie an das Backend
 * und rendert Frage + Antwort im Chat-UI.
 */
function sendeFrage() {
  // Eingabetext aus UI holen
  const frage = document.getElementById("nutzerFrage").value;
  console.log("⬆️ Frage wird gesendet:", frage);

  // Eingabevalidierung: leere Frage abfangen
  if (!frage) {
      const fehlerEl = document.getElementById("frageFehler");
      fehlerEl.textContent = "❗ Bitte gib eine Frage ein.";
      fehlerEl.style.display = "block";
      
      // Fehler nach 3 Sekunden automatisch ausblenden
      setTimeout(() => {
        fehlerEl.style.display = "none";
      }, 3000);
      return; // ohne gültige Frage nicht fortfahren
  }
      
  // Verlauf initialisieren, falls noch nicht vorhanden
  if (!chatThreads[aktuellerPOIKey]) {
    chatThreads[aktuellerPOIKey] = [];
  }
  
  // Frage an Verlauf anhängen
  chatThreads[aktuellerPOIKey].push({ role: "user", content: frage });
  
  // Frage über API senden
  fetch("http://localhost:5000/api/poi-dialog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: chatThreads[aktuellerPOIKey]    // gesamter Verlauf als Kontext senden
    })
  })
    .then(res => res.json())                    // Serverantwort als JSON parsen
    .then(data => {
      const antwort = data.text;                // Modell Backend Antwort
      letzteGPTAntwort = antwort;               // separat vorhalten (TTS)
      // Antwort in Verlauf speichern
      chatThreads[aktuellerPOIKey].push({ role: "assistant", content: antwort });
  
      // Frage und Antwort im Dialog anzeigen 
      const verlauf = document.getElementById("chatVerlauf");
      const frageEl = document.createElement("p");

      // rendert HTML
      frageEl.innerHTML = `<strong>Du:</strong> ${frage}`;
      const antwortEl = document.createElement("p");
      antwortEl.innerHTML = `<strong>Antwort:</strong> ${antwort}`;

      // EIngabefeld leeren und Eingabe UI ausblenden
      verlauf.appendChild(frageEl);
      verlauf.appendChild(antwortEl);
    
      document.getElementById("nutzerFrage").value = "";
      document.getElementById("frageEingabe").style.display = "none";
    })
    .catch(err => {
      // Netz-/Server-/Parsing-Fehler landen hier
      console.error("Fehler beim Senden der Frage:", err);
    });
}
// END - function sendeFrage()


// beim Abbrechen eines POIs werden die dynamsichen Buttons ausgeblendet
function abbrechenFrage() {
  document.getElementById("frageEingabe").style.display = "none";
  document.getElementById("nutzerFrage").value = "";
  document.getElementById("frageFehler").style.display = "none";
}
// END - function abbrechenFrage()


/**
 * Sendet ohne explizite Nutzerfrage einen Folge-Prompt, um
 * zu einem POI (aktuellerPOIKey) zusätzliche Details zu erhalten.
 * Nutzt den bestehenden Chat-Verlauf (chatThreads) und rendert
 * die Antwort in #chatVerlauf.
 */
function sendeMehrInfos() {
    // wenn kein aktiver POI gewählt ist: nichts tun
    if (!aktuellerPOIKey) return;
  
    // passenden Thread/Verlauf zum aktiven POI holen
    const verlauf = chatThreads[aktuellerPOIKey];
    if (!verlauf) return;   // kein Verlauf vorhanden -> abbrechen
  
    // Promptgenerierung
    const ort = aktuellerOrt || "diesem Ort";       // Fallback Ortsname
    const name = aktuellerPOIKey.split("|")[0];     // POI-Namensteil aus dem Key nehmen

    // Folge-Prompt: bittet um mehr Details, ohne Wiederholungen
    const folgePrompt = `Gib mir mehr und detailiertere Informationen zu ${name} in ${ort}, ohne die vorherigen Informationen zu wiederholen`;
  
    // Nutzer-Nachricht in den Verlauf anhängen
    verlauf.push({ role: "user", content: folgePrompt });
  
    //Prompt über API senden
    fetch("http://localhost:5000/api/poi-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: verlauf })       // gesamter Verlauf als Kontext
    })
      .then(res => res.json())                          // Serverantwort als JSON lesen
      .then(data => {
        const antwort = data.text;                      // Modellantwort
        // Antwort in den Verlauf schreiben
        verlauf.push({ role: "assistant", content: antwort });
  
        // letzte Antwort auch separat vorhalten (für weitere Features)
        letzteGPTAntwort = antwort; 
  
        // UI Update: Antwort im Chat anzeigen
        const verlaufEl = document.getElementById("chatVerlauf");
        const antwortEl = document.createElement("p");
        // einfache Markierung als "Weitere Informationen"
        antwortEl.innerHTML = `<strong>Weitere Informationen:</strong> ${antwort}`;
        verlaufEl.appendChild(antwortEl);
      })
      .catch(err => {
        // Netzwerk-/Server-/Parsing-Fehler landen hier
        console.error("Fehler bei Folge-Info:", err);
      });
  }
// END - function sendeMehrInfos()


/**
 * Startet die Spracheingabe (nur in Chrome via webkitSpeechRecognition)
 * und schreibt das erkannte Ergebnis in das Inputfeld #nutzerFrage.
 * Zeigt Fehler in #frageFehler an.
 */
function sprichFrage() {
  // Feature-Detection: Browser unterstützt keine (webkit-)SpeechRecognition
  if (!('webkitSpeechRecognition' in window)) {
    alert("Dein Browser unterstützt leider keine Spracheingabe.");
    return;   // ohne Support: frühzeitig abbrechen
  }
  
  // Instanz der Web Speech API (Chrome-Implementierung)
  const recognition = new webkitSpeechRecognition();  // Nur Chrome aktuell
  recognition.lang = "de-DE";                         // Sprache auf Deutsch setzen
  recognition.interimResults = false;                 // nur finale Ergebnisse liefern
  recognition.maxAlternatives = 1;                    // beste Alternative genügt
  
  // Erkennung starten (Browser fragt ggf. nach Mikrofonfreigabe)
  recognition.start();
  console.log("🎙️ Spracheingabe gestartet...");
  
  // Callback: Ein Ergebnis wurde erkannt
  recognition.onresult = (event) => {
    // Zugriff auf das beste Transkript der ersten Ergebnishypothese
    const gesprochenerText = event.results[0][0].transcript;
    console.log("🎧 Erkannt:", gesprochenerText);

    // erkannten Text in das Eingabefeld schreiben
    document.getElementById("nutzerFrage").value = gesprochenerText;
  };
  
  // Callback: Fehler während der Erkennung (z.B. permission-denied, no-speech)
  recognition.onerror = (event) => {
    console.error("Spracherkennung-Fehler:", event.error);

    // Fehlermeldung im UI anzeigen
    const fehlerText = document.getElementById("frageFehler");
    fehlerText.textContent = "Fehler bei der Spracheingabe: " + event.error;
    fehlerText.style.display = "block";
  };
  
  // Callback: Erkennung endet, sobald der Nutzer aufhört zu sprechen
  recognition.onspeechend = () => {
    recognition.stop();
    console.log("🛑 Spracheingabe beendet.");
  };
}
// END - function sprichFrage()





