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
// document.getElementById("pingButton") - END


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
// function berechneEntfernungMeter - END
  

// Window zur Anzeige der POIs in der Nähe
window.addEventListener("load", () => {
  if ("geolocation" in navigator) {
    document.getElementById("gpsStatus").textContent = "GPS-Tracking aktiv …";
  
    let aktuelleLat = null;
    let aktuelleLon = null;
      
    navigator.geolocation.watchPosition(
      (position) => {
          const lat = position.coords.latitude.toFixed(6);
          const lon = position.coords.longitude.toFixed(6);
          aktuelleLat = parseFloat(lat);
          aktuelleLon = parseFloat(lon);
          const liste = document.getElementById("poiListe");
          liste.innerHTML = "";
          let gefiltertePOIs = [];
            

          // Koordinaten im Frontend anzeigen
          document.getElementById("liveCoords").textContent =
            `Breitengrad: ${lat} | Längengrad: ${lon}`;
          

          // Ort anzeigen
          fetch(`http://localhost:5000/api/location_name?lat=${aktuelleLat}&lon=${aktuelleLon}`)
            .then(res => res.json())
            .then(data => {
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
            const pois = data.pois;
            const liste = document.getElementById("poiListe");
            liste.innerHTML = ""; 

            if (pois && pois.length > 0) {
              let gefiltertePOIs = [];
            
              pois.forEach((poi) => {
                const name = poi.tags?.name;
                if (!name) return;
            
                const typ = poi.tags?.tourism || poi.tags?.historic || poi.tags?.amenity || "unbekannt";
                const plat = poi.lat || poi.center?.lat;
                const plon = poi.lon || poi.center?.lon;
                if (!plat || !plon || !aktuelleLat || !aktuelleLon) return;
            
                const distanz = berechneEntfernungMeter(aktuelleLat, aktuelleLon, plat, plon);
                gefiltertePOIs.push({ name, typ, distanz, tags: poi.tags });
              });
            
              // POIs nach Entfernung sortieren
              gefiltertePOIs.sort((a, b) => a.distanz - b.distanz);
          
              if (gefiltertePOIs.length > 0) {
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
                
                document.getElementById("gpsStatus").textContent =
                  `📍 ${gefiltertePOIs.length} POI${gefiltertePOIs.length === 1 ? '' : 's'} in deiner Nähe`;
              } else {
                document.getElementById("gpsStatus").textContent = "Kein POI in der Nähe.";
                liste.innerHTML = "<li>Keine Ergebnisse.</li>";
              }
            } else {
              document.getElementById("gpsStatus").textContent = "Kein POI in der Nähe.";
              liste.innerHTML = "<li>Keine Ergebnisse.</li>";
            }
          })
          .catch((err) => {
            console.error("Fehler bei POI-Abfrage:", err);
          });
      },
      (error) => {
        document.getElementById("gpsStatus").textContent = "Fehler beim GPS-Tracking.";
        console.error("GPS-Fehler:", error);
      },
      {
        enableHighAccuracy: true, // verwendet echtes GPS, wenn möglich
        maximumAge: 0,            // keine alten Daten verwenden
        timeout: 10000            // 10s Timeout bei Nichterreichbarkeit
      }
    );
  } else {
    document.getElementById("gpsStatus").textContent = "Geolocation nicht unterstützt.";
  }
});
// Window-POIs in der Nähe - END


// gibt die KI-Informationen zum POI
function ladePOIInfo(poi) {
  const name = poi.name;
  const tags = poi.tags || {};
  let typ = "Ort";
  
  // Priorisierte Tag-Auswertung
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
  
  // Prompt zusammenbauen
  const prompt = `Gib mir einen Informationstext zu ${typ} "${name}" in ${aktuellerOrt} von max 4 Sätzen, der in einem Audioguide genutzt werden kann`;

  // Testweise in Konsole anzeigen
  console.log("📤 Generierter Prompt:", prompt);
  
  // Textbereich vorbereiten
  const antwortBereich = document.getElementById("antwortBereich");
  antwortBereich.innerHTML = "<p>⏳ Informationen werden geladen …</p>";

  fetch("http://localhost:5000/api/poi-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(res => res.json())
    .then(data => {
      if (data.text) {
          aktuellerPOIKey = `${poi.name}|${aktuellerOrt}`; 
          chatThreads[aktuellerPOIKey] = [
              { role: "user", content: data.prompt },
              { role: "assistant", content: data.text }
            ];
            letzteGPTAntwort = data.text;
            document.getElementById("poiListeWrapper").style.display = "none";

            //dynamisches HTML
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
            document.getElementById("vorlesenBtn").addEventListener("click", () => {
              const safe = letzteGPTAntwort.replace(/["']/g, "");
              console.log(safe);
              spieleTTS(safe);
            });
      } else {
        antwortBereich.innerHTML = "<p>⚠️ Es gab ein Problem bei der Antwort.</p>";
      }
    })
    .catch(err => {
      console.error("Fehler bei GPT-Antwort:", err);
      antwortBereich.innerHTML = "<p>⚠️ Fehler beim Laden der Information.</p>";
    });
}
// function ladePOIInfo - END
  

// text2speech - Generierung
function spieleTTS(text) {
  fetch("http://localhost:5000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text })
  })
    .then(res => {
      if (!res.ok) throw new Error("Audio konnte nicht geladen werden");
      return res.blob();
    })
    .then(blob => {
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.play();
    })
    .catch(err => {
      console.error("TTS-Fehler:", err);
    });
}
// function spieleTTS - END


// erstellt das Frage-Eingabe-Feld
function zeigeFrageEingabe() {
  document.getElementById("frageEingabe").style.display = "block";
}
// function zeigeFrageEingabe - END


// schließt den KI-Dialog zum POI und leert den Verlauf
function schließePOI() {
  document.getElementById("antwortBereich").innerHTML = "";
  document.getElementById("poiListeWrapper").style.display = "block";
  aktuellerPOIKey = null;
  letzteGPTAntwort = "";
}
// function schließePOI - END


// sendet die Frage über API an ChatGPT
function sendeFrage() {
  const frage = document.getElementById("nutzerFrage").value;
  console.log("⬆️ Frage wird gesendet:", frage);

  // abfangen einer "leeren" Frage
  if (!frage) {
      const fehlerEl = document.getElementById("frageFehler");
      fehlerEl.textContent = "❗ Bitte gib eine Frage ein.";
      fehlerEl.style.display = "block";
      
      // Fehler nach 3 Sekunden automatisch ausblenden
      setTimeout(() => {
        fehlerEl.style.display = "none";
      }, 3000);
      return;
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
      messages: chatThreads[aktuellerPOIKey]
    })
  })
    .then(res => res.json())
    .then(data => {
      const antwort = data.text;
      letzteGPTAntwort = antwort;  
      chatThreads[aktuellerPOIKey].push({ role: "assistant", content: antwort });
  
      // Im Chat anzeigen
      const verlauf = document.getElementById("chatVerlauf");
      const frageEl = document.createElement("p");
      frageEl.innerHTML = `<strong>Du:</strong> ${frage}`;
      const antwortEl = document.createElement("p");
      antwortEl.innerHTML = `<strong>Antwort:</strong> ${antwort}`;
      verlauf.appendChild(frageEl);
      verlauf.appendChild(antwortEl);
    
      document.getElementById("nutzerFrage").value = "";
      document.getElementById("frageEingabe").style.display = "none";
    })
    .catch(err => {
      console.error("Fehler beim Senden der Frage:", err);
    });
}
// function sendeFrage - END


// ermöglicht das Abbrechen einer Frage und schließt die Buttons
function abbrechenFrage() {
  document.getElementById("frageEingabe").style.display = "none";
  document.getElementById("nutzerFrage").value = "";
  document.getElementById("frageFehler").style.display = "none";
}
// function abbrechenFrage - END


// ermöglicht mehr Informationen zu POI zu erhalten ohne Frage zu stellen
function sendeMehrInfos() {
    if (!aktuellerPOIKey) return;
  
    const verlauf = chatThreads[aktuellerPOIKey];
    if (!verlauf) return;
  
    // Promptgenerierung
    const ort = aktuellerOrt || "diesem Ort";
    const name = aktuellerPOIKey.split("|")[0];
    const folgePrompt = `Gib mir mehr und detailiertere Informationen zu ${name} in ${ort}, ohne die vorherigen Informationen zu wiederholen`;
  
    verlauf.push({ role: "user", content: folgePrompt });
  
    //Prompt über API senden
    fetch("http://localhost:5000/api/poi-dialog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: verlauf })
    })
      .then(res => res.json())
      .then(data => {
        const antwort = data.text;
        verlauf.push({ role: "assistant", content: antwort });
  
        letzteGPTAntwort = antwort; 
  
        const verlaufEl = document.getElementById("chatVerlauf");
        const antwortEl = document.createElement("p");
        antwortEl.innerHTML = `<strong>Weitere Informationen:</strong> ${antwort}`;
        verlaufEl.appendChild(antwortEl);
      })
      .catch(err => {
        console.error("Fehler bei Folge-Info:", err);
      });
  }


// ermöglicht das Sprechen von Fragen und Umwandlung in Text
function sprichFrage() {
  if (!('webkitSpeechRecognition' in window)) {
    alert("Dein Browser unterstützt leider keine Spracheingabe.");
    return;
  }
  
  const recognition = new webkitSpeechRecognition();  // Nur Chrome aktuell
  recognition.lang = "de-DE";                         // Sprache auf Deutsch setzen
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  
  recognition.start();
  console.log("🎙️ Spracheingabe gestartet...");
  
  recognition.onresult = (event) => {
    const gesprochenerText = event.results[0][0].transcript;
    console.log("🎧 Erkannt:", gesprochenerText);
    document.getElementById("nutzerFrage").value = gesprochenerText;
  };
  
  recognition.onerror = (event) => {
    console.error("Spracherkennung-Fehler:", event.error);
    const fehlerText = document.getElementById("frageFehler");
    fehlerText.textContent = "Fehler bei der Spracheingabe: " + event.error;
    fehlerText.style.display = "block";
  };
  
  recognition.onspeechend = () => {
    recognition.stop();
    console.log("🛑 Spracheingabe beendet.");
  };
}
// function sprichFrage - END





