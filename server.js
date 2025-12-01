// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Feste Teilnehmenden-Liste
const NAMES = [
  "Anni",
  "Ben",
  "Beni",
  "Daniel",
  "Elisa",
  "Till",
  "Dustin",
  "Johann",
  "Lara",
  "Marvin",
  "Paul"
];

// Datei für den gespeicherten Zustand (quasi "Datenbank")
const STATE_FILE = path.join(__dirname, "state.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Hilfsfunktionen für State --------------------

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Konnte state.json nicht lesen:", e);
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// -------------------- Derangement (eindeutige Zuordnung) --------------------

/**
 * Erzeugt eine zufällige Zuordnung (Permutation), bei der:
 * - niemand sich selbst zieht
 * - jede Person genau einmal gezogen wird
 */
function createDerangement(names) {
  const n = names.length;

  if (n < 2) {
    throw new Error("Zu wenige Namen für Wichteln.");
  }

  // Spezialfall 2: einfach tauschen
  if (n === 2) {
    return {
      [names[0]]: names[1],
      [names[1]]: names[0]
    };
  }

  let perm;
  let attempts = 0;

  do {
    attempts++;
    perm = [...names];

    // Fisher-Yates Shuffle = echte zufällige Permutation ohne Duplikate
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }

    if (attempts > 10000) {
      throw new Error("Konnte keinen gültigen Wichtel-Plan erzeugen.");
    }
  } while (perm.some((name, index) => name === names[index]));

  const assignments = {};
  for (let i = 0; i < n; i++) {
    assignments[names[i]] = perm[i];
  }

  // Sicherheit: prüfen, ob die Zuordnung gültig ist
  validateAssignments(assignments, names);

  return assignments;
}

/**
 * Prüft die Zuordnung:
 * - alle Namen existieren als Schlüssel
 * - alle Namen kommen genau einmal als Wert vor
 * - niemand hat sich selbst
 */
function validateAssignments(assignments, names) {
  const keys = Object.keys(assignments);
  if (keys.length !== names.length) {
    throw new Error("Ungültige Zuordnung: Anzahl Schlüssel passt nicht.");
  }

  const values = Object.values(assignments);
  if (values.length !== names.length) {
    throw new Error("Ungültige Zuordnung: Anzahl Werte passt nicht.");
  }

  // selbst ziehen?
  for (const name of names) {
    if (!assignments[name]) {
      throw new Error(`Ungültige Zuordnung: Kein Wichtel für ${name}.`);
    }
    if (assignments[name] === name) {
      throw new Error(`Ungültige Zuordnung: ${name} beschenkt sich selbst.`);
    }
  }

  // doppelte Giftees?
  const valueSet = new Set(values);
  if (valueSet.size !== values.length) {
    throw new Error("Ungültige Zuordnung: Ein Name wird mehrfach beschenkt.");
  }
}

// -------------------- State initialisieren --------------------

/**
 * Initialisiert den Zustand.
 * forceNew = true -> erzeugt immer eine neue Zuordnung
 */
function initState(forceNew = false) {
  let state = forceNew ? null : loadState();

  if (!state || !state.assignments) {
    console.log("Erzeuge neue Wichtel-Zuordnung ...");
    const assignments = createDerangement(NAMES);
    state = {
      names: NAMES,
      assignments,
      revealed: [] // Liste der GEBER, die ihren Wichtel schon gesehen haben
    };
    saveState(state);
  } else {
    // Sicherheit: prüfen, ob gespeicherte Zuordnung noch valide ist
    try {
      validateAssignments(state.assignments, NAMES);
    } catch (e) {
      console.warn("Gespeicherte Zuordnung war ungültig, erzeuge neu:", e.message);
      const assignments = createDerangement(NAMES);
      state = {
        names: NAMES,
        assignments,
        revealed: []
      };
      saveState(state);
    }
  }

  return state;
}

/**
 * Öffentlicher State fürs Frontend (ohne geheime Zuordnungen).
 */
function getPublicState() {
  const state = initState();
  const revealedSet = new Set(state.revealed);
  const availableNames = state.names.filter(n => !revealedSet.has(n));

  return {
    names: state.names,
    availableNames,
    revealed: state.revealed
  };
}

// -------------------- API-Routen --------------------

// Aktueller Zustand (für Frontend)
app.get("/api/state", (req, res) => {
  try {
    const publicState = getPublicState();
    res.json(publicState);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Laden des Zustands." });
  }
});

// Wichtel ziehen
app.post("/api/draw", (req, res) => {
  const { name } = req.body;

  if (!name || !NAMES.includes(name)) {
    return res.status(400).json({ error: "Ungültiger Name." });
  }

  let state = initState();

  if (!state.assignments[name]) {
    return res.status(400).json({ error: "Für diesen Namen gibt es keine Zuordnung." });
  }

  const alreadyRevealed = state.revealed.includes(name);
  const giftee = state.assignments[name];

  if (!alreadyRevealed) {
    state.revealed.push(name);
    saveState(state);
  }

  res.json({
    name,
    giftee,
    alreadyRevealed
  });
});

// Reset (für Tests)
app.post("/api/reset", (req, res) => {
  try {
    const state = initState(true);
    res.json({ ok: true, message: "Wichtel-Runde zurückgesetzt." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Reset." });
  }
});

// Debug: komplette Zuordnung anzeigen (nur zum Testen!)
// -> http://localhost:3000/api/debug-assignments
app.get("/api/debug-assignments", (req, res) => {
  try {
    const state = initState();
    res.json(state.assignments);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Debug-Zugriff." });
  }
});

// -------------------- Serverstart --------------------

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
