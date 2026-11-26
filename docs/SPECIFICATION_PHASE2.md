# Spezifikation Phase 2 (v1.1): „Trainer-Exzellenz & Mobile UX“

**Status:** Finalisiert (nach `/grill-me`-Abstimmung)  
**Datum:** 18. November 2026  
**Bezugsbasis:** [MVP-Spezifikation v1.2 (Phase 1)](SPECIFICATION.md)  
**Ziel:** Maximale Qualität und Geschwindigkeit für Trainer am Desktop, Tablet und Smartphone – vor Trainings-Analyse (Phase 3), Kader/Kollaboration (Phase 4) und Video/Sharing/SaaS (Phase 5).

---

## 1. Abgestimmte Gesamt-Roadmap (Phase 2 – Phase 5)

| Phase | Titel & Fokus | Enthaltene Schwerpunkte |
| :--- | :--- | :--- |
| **Phase 1 (MVP)** *(Abgeschlossen)* | **Offline-PWA & Kernfunktionen** | Vereins-/Team-Modell, SVG-Taktikboard, KI-JSON-Importer, Speed-Planning, Mehrwochenpläne, Hallen-Modus, Supabase-Sync |
| **Phase 2 (v1.1)** *(Diese Spezifikation)* | **Trainer-Exzellenz & Mobile UX** | **Modul 1:** Animiertes Taktikboard (Keyframes, Spiegeln, Kurven-Handles, Zonen, Undo/Redo, Export, Glyphen)<br>**Modul 2:** Druck- & PDF-Export (Einzeltraining & Übungskarte)<br>**Modul 3:** Smartphone-UX (Slide-Over), Katalog/Planer-Komfort, Intervall-Timer & Live-Punktezähler |
| **Phase 3 (v1.2)** *(Geplant)* | **Trainings-Analyse & Belastungssteuerung** | Trainingsfokus-Auswertung (Ist vs. Soll auf Basis `TrainingSession` + `SessionBlock` + `Exercise.categories.focus`, inkl. vergangener nicht-abgesagter Trainings), „Zuletzt trainiert am …“-Badge, Intensitäts-Level (*Locker / Mittel / Hoch / Spielnah*) |
| **Phase 4 (v1.3)** *(Geplant)* | **Kader, Logins & Echtzeit-Kollaboration** | Kaderverwaltung, optionale Spieler-/Eltern-Logins (RSVP), 10s-Hallen-Check-In, Spielerzahl-Warnung & Quick-Swap-Filter, Trainerteam-Realtime-Sync (Supabase Realtime) & Konflikt-UI |
| **Phase 5 (v2.0)** *(Geplant)* | **Video-Hosting, Sharing & SaaS** | Eigenes Video-Hosting (Supabase Storage + selektiver Offline-Cache), Slow-Motion-Player, Offline-Vollbackup & Übungspaket-Export/Import (`.json`), **Öffentlicher Übungskatalog (`PUBLIC`, schreibgeschützte Kopiervorlagen für Fremdvereine inkl. Kuratierungs-/Freigabe-Workflow)**, Abo-/Bezahlsystem für Fremdvereine |

---

## 2. Modul 1: Animiertes Taktikboard & Zeichen-Upgrades

Das Taktikboard ([TacticBoardEditor.tsx](../src/components/TacticBoardEditor.tsx)) wird zu einem **Handball-Animations- & Präsentationswerkzeug** ausgebaut – 100 % SVG-basiert, offline-fähig und leichtgewichtig.

### 2.1 Abwärtskompatibles Datenmodell (`TacticBoardData` v2)

Bestehende `version: 1`-Skizzen bleiben unverändert lauffähig. Erweiterung in [domain.ts](../src/types/domain.ts):

```typescript
export interface TacticZone {
  id: string;
  shape: 'RECT' | 'ELLIPSE';
  x: number;          // 0.0 – 1.0
  y: number;
  width: number;      // 0.0 – 1.0
  height: number;
  rotation?: number;
  color: string;      // z. B. '#EF4444' (Sperrzone) oder '#22C55E' (Zielzone)
  opacity?: number;   // Standard: 0.22
  label?: string;     // z. B. "Nahtstelle", "Abschlusszone"
}

// Erweiterung TacticPath:
// controlPoint?: { x: number; y: number } // Interaktiver Kurven-Handle für Bezier-Bögen

export interface TacticKeyframeNodeState {
  x: number;
  y: number;
  hasBall?: boolean;
  rotation?: number;
  visible?: boolean;  // Zum Ein-/Ausblenden von Spielern pro Szene
}

export interface TacticKeyframe {
  id: string;
  index: number;            // 0, 1, 2, ...
  label?: string;           // z. B. "1. Anstoßen RL", "2. Parallelpass RM"
  durationMs: number;       // Übergangsdauer (Standard: 1400 ms)
  pauseAfterMs?: number;    // Haltezeit am Ende des Schritts (Standard: 300 ms)
  nodeStates: Record<string, TacticKeyframeNodeState>; // Key = TacticNode.id
  activePathIds?: string[]; // Pfade, die in diesem Schritt hervorgehoben werden
  ballPosition?: {
    holderNodeId?: string;  // Ball klebt am Spieler
    x?: number;             // Freier Ball / Pass-Flugbahn ohne Spielerbewegung
    y?: number;
  };
}

export interface TacticBoardAnimationSettings {
  defaultSpeed: 0.5 | 1 | 1.5 | 2;
  loop: boolean;
  showTrails: boolean;          // Bewegungs-Schweif während der Animation
  showPathsDuringPlay: boolean; // Statische Pfeile beim Abspielen ein-/ausblenden
}
```

### 2.2 Handball-spezifische Zeichen- & Animations-Features
1. **1-Klick-Horizontal-Spiegeln (inkl. Positions-Tausch):**
   * Spiegelt alle `nodes` (`x = 1 - x`), `paths` (inkl. `points` und `controlPoint`), `zones` und `keyframes` vertikal an der Spielfeld-Mittelachse.
   * **Intelligenter Positions-Tausch:** `LA ↔ RA`, `RL ↔ RR`, `AL ↔ AR`, `HL ↔ HR`, `IL ↔ IR` werden automatisch mitgetauscht (`RM`, `KM`, `TW`, `HM`, `VM` bleiben unverändert).
2. **Interaktive Kurven-Handles (`controlPoint`):**
   * Bei markiertem Pfad erscheint ein anfassbarer Kurven-Punkt (Quadratische/Kubische Bezier-Kurve), mit dem Bogenläufe, Einlaufen vom Flügel oder bogenförmige Stoßbewegungen präzise gezogen werden können.
3. **1-Klick-Auto-Animation aus bestehenden Skizzen:**
   * Button **„✨ Animation aus Schritten erzeugen“** analysiert vorhandene `paths` nach `stepNumber` (`1, 2, 3…`) und generiert automatisch Keyframes:
     * `RUN_PATH` / `DRIBBLE_PATH` / `FEINT_PATH`: Bewegt den Spieler entlang des Pfads (inkl. Kurve!).
     * `PASS_PATH`: Übergibt `hasBall` an den Zielspieler und animiert den Ballflug – auch als **reiner Ballwechsel ohne Spielerbewegung**.
4. **Timeline-Editor & Onion-Skinning:**
   * Umschalter: `✏️ Skizze` | `🎬 Animation`.
   * Horizontale Timeline-Karten (`Szene 1`, `Szene 2`, `+ Szene`, Duplizieren, Löschen, Schrittdauer).
   * **Onion-Skinning:** Im aktiven Keyframe `k > 0` erscheinen bewegte Spieler an ihrer Vorher-Position (`k - 1`) als halbtransparente Geister-Symbole (30 % Opazität) mit gestrichelter Hilfslinie.
   * **Spieler ein-/ausblenden (`visible`):** Ermöglicht z. B. das Ausblenden von Abwehrspielern in einer Vorübung oder das Einblenden eines Gegenspielers in Phase 2.
5. **Undo / Redo (`Strg+Z` / `Strg+Y`):**
   * Mindestens 30 Schritte Verlauf für Skizze und Keyframes.
6. **Zonen-Markierungen (`TacticZone`):**
   * Halbtransparente Rechtecke/Ellipsen für Zielräume, 1:1-Sektoren oder Verbotszonen mit optionaler Beschriftung.
7. **60-FPS-Player in Vorschau & Sporthalle ([FullScreenChalkboardModal.tsx](../src/components/FullScreenChalkboardModal.tsx)):**
   * `▶ Play / ⏸ Pause`, `⏮ Zurück`, `⏭ Weiter`, Scrubber-Zeitleiste, Speed (`0.5x`–`2x`), `🔁 Loop`.
   * **Kombination mit Live-Zeichenstift:** In der Halle jederzeit pausieren und mit dem Finger/Stift direkt auf dem pausierten Frame markieren.
8. **Export (PNG / SVG / WebM-Clip):**
   * 1-Klick-Download als statisches PNG/SVG sowie clientseitiger WebM-Export der Animation (via Canvas/MediaRecorder, ohne Server).
9. **KI-JSON-Importer v2 ([AiExerciseImporterModal.tsx](../src/components/AiExerciseImporterModal.tsx)):**
   * System-Prompt & Validator unterstützen `zones`, `controlPoint` und `keyframes` sowie Option *„Nummerierte Schritte automatisch als Animation importieren“*.
10. **Verbesserte Spieler-Glyphen & Blickrichtung ([TacticPlayerGlyph.tsx](../src/components/TacticPlayerGlyph.tsx)):**
    * **Schwarze Blickrichtung:** Sowohl beim Angreifer-Dreieck als auch beim Abwehr-Kreis wird die Blickrichtungs-Spitze bzw. das Blickrichtungs-Segment **schwarz ausgefüllt** (`#0f172a` / `#000000`) statt hellblau/hellrot, um maximalen Kontrast auf allen Spielfeldfarben zu erzielen.
    * **Größeres Segment bei Abwehrspielern:** Das Kreissegment der Blickrichtung beim Defensiv-Symbol wird deutlich vergrößert (größerer Öffnungswinkel / tieferer Anschnitt bis ca. `y = -7` bei `r = 16`), damit die Ausrichtung der Abwehrspieler auch auf Smartphones und in der Hallen-Vorschau sofort erkennbar bleibt.

---

## 3. Modul 2: Druck- & PDF-Export (Einzeltraining & Übungskarte)

100 % offline über dedizierte `@media print`-Layouts (`window.print()` → „Als PDF speichern“ auf Windows, iPadOS, Android) mit gestochen scharfen Vektor-SVGs.

### 3.1 Priorität 1: Einzeltraining („Hallen-Handout“, A4)
* **Kopfzeile:** Mannschaft, Datum, Uhrzeit, Tagesschwerpunkt, Gesamtdauer.
* **Geräteraum-Box:** Aggregierte Material-Checkliste mit Papier-Checkboxen (`[ ] 10 Hütchen`).
* **Ablaufplan:** Chronologische Phasen & Blöcke inkl. sauberer Nebeneinander-Spalten für **parallele Spuren** (Spur A | Spur B + verantwortlicher Trainer).
* **Layout-Optionen vor dem Druck:**
  * *Kompakt (1-Seiter für das Klemmbrett)* vs. *Detail-Handout (inkl. Aufbau, Ablauf, Coaching-Punkte & gerenderten Taktik-Skizzen)*.

### 3.2 Priorität 2: Einzelübung („Übungskarte“, A4)
* Karteikarte für eine Übung: Große Taktik-Skizze (oder Referenzbild), Metadaten (Dauer, Spielerzahl, Material, Tags), strukturierte Beschreibung (*Aufbau, Ablauf, Coaching-Punkte, Varianten*).

---

## 4. Modul 3: Smartphone-UX & Trainer-Alltags-Feinschliff

### 4.1 Smartphone-UX: Full-Screen Slide-Over Overlay (Master-Detail Best Practice)
* **Problem in [App.tsx](../src/App.tsx#L736):** Auf `< 1024px` (`lg:`) stapelt das Grid die Übungsdetails ganz unten unter der kompletten Liste.
* **Lösung:**
  * **Desktop (`>= 1024px`):** Behält das 2-Spalten-Cockpit (Liste links, Detail rechts).
  * **Smartphone (`< 1024px`):** Tippt der Trainer auf eine Übung, öffnet sich ein **Full-Screen Slide-Over Overlay** (`fixed inset-0 z-40 bg-white overflow-y-auto`) mit Sticky-Header (`← Zurück zur Liste` links, `Bearbeiten / PDF / Variante` rechts). Beim Schließen steht die Liste **exakt an der vorherigen Scroll-Position**.
* **Mobile-Check weiterer Views:** Kompakte aufklappbare Filterleisten auf Smartphones, Touch-Targets `>= 44×44px`, kein ungewolltes horizontales Scrollen in Planer & Taktikboard.

### 4.2 Katalog & Planer ([TrainingSessionPlanner.tsx](../src/components/TrainingSessionPlanner.tsx))
1. **Übungskatalog:** Favoriten (`is_favorite`) anheftbar; kombinierbare Multi-Filter (*Phase + Schwerpunkt + Level + Spielerzahl*) & Volltextsuche über alle Textfelder.
2. **Trainingsplaner:** Drag-and-Drop für Übungsblöcke innerhalb und zwischen Phasen, Inline-Bearbeitung von Dauer (`Min`) & Spur-Label direkt in der Zeile, Phasen-Zeitbudget (*Ist vs. Soll*).

### 4.3 Hallen-Modus ([HallLiveMode.tsx](../src/components/HallLiveMode.tsx))
1. **Timer-Signal & Vorschau:** Optionales Audio-/Vibrations-Signal bei Ablauf des Abschnitts-Timers sowie kompakte **„Als Nächstes“-Vorschau** (nächste Übung + Materialbedarf).
2. **Intervall- / Zirkel-Timer:** Konfigurierbarer Belastungs-/Pausen-/Runden-Timer (z. B. `30s Belastung / 15s Pause × 8 Runden`, inkl. Schnell-Presets wie Tabata `20s/10s`) direkt als umschaltbarer Tab neben dem Abschnitts-Timer.
3. **Live-Punktezähler (Team A vs. Team B):** Kompaktes Scoreboard-Widget (Teamnamen optional anpassbar, `+1` / `-1` / `Reset`) für Wettkampf-Spielformen in der Halle.

---

## 5. Modul 4: UI-Vereinfachung, Konfigurations-Menü & Guided-Config-Tour

* **Ziel:** Trainer können nicht benötigte Bereiche, Buttons und Filter gezielt abschalten, um das UI auf ihren konkreten Trainingsalltag zu reduzieren.
* **Konfigurierbare Funktionen ([uiPreferences.ts](../src/utils/uiPreferences.ts)):**
  * *Hauptbereiche & Navigation:* `hallLiveMode` (Sporthallen-Modus), `multiWeekPlans` (Mehrwochenplan), `clubAdmin` (Verein, Teams & Trainer)
  * *Werkzeuge & Aktionen:* `aiImport` (KI-JSON Import), `printExport` (Druck- & PDF-Export), `exerciseVariants` (Varianten ableiten), `tacticAnimation` (Animiertes Taktikboard)
  * *Datenbank & Filter:* `advancedFilters` (Detailfilter), `favorites` (Favoriten-Sterne)
  * *System & Sync:* `backupExport` (JSON-Vollbackup) — Cloud-Login (sofern Supabase konfiguriert ist) und die PWA-Installationshilfe (im Webbrowser) werden automatisch angezeigt
* **Schnell-Profile (Presets):** *Fokus / Minimal*, *Standard (Trainer & Jugend)* und *Alle Funktionen (Profi / Admin)*.
* **Konfigurations-Menü ([UiConfigModal.tsx](../src/components/UiConfigModal.tsx)):** Über *„UI anpassen“* in Sidebar und Topbar jederzeit erreichbar; automatischer Fallback auf `DASHBOARD`, falls der aktuell geöffnete Tab deaktiviert wird.
* **Guided-Config-Tour ([UiConfigTourModal.tsx](../src/components/UiConfigTourModal.tsx)):** 4-schrittiger Einrichtungs-Assistent für neue / neu angemeldete Nutzer (und jederzeit über das Konfigurations-Menü erneut startbar).

---

## 6. Vorgemerkte Erweiterung (Backlog, noch nicht umgesetzt)

* **Mehrere Bälle im Taktikboard (gleichzeitig oder sequentiell):**
  * **Anforderung:** Im Taktikboard-Editor und in der Animation sollen mehrere Bälle (z. B. Ball 1 bei `RL`, Ball 2 bei `RR` oder bei einem Trainer/Ballwagen) gleichzeitig oder zeitversetzt/sequentiell geführt und gepasst werden können (z. B. Parallel-Passübungen, Gegenstoß-Wellen mit zwei Bällen, Nachwurf-Übungen).
  * **Technischer Ansatz:** Erweiterung von `TacticKeyframe` um `balls?: Array<{ id: string; holderNodeId?: string; x?: number; y?: number; visible?: boolean }>` (abwärtskompatibel zu `ballPosition`), Multi-Ball-Interpolation in `interpolateTacticBoardAtTime` sowie Zuordnung von `PASS_PATH` / `SHOT_PATH` zu einer Ball-ID.
