// lib/narrative/motif-lexicon-de.ts
//
// German motif lexicon for the deterministic motif analyzer
// (see ./motif-diversity.ts). German is the primary output language of
// the narrative pipeline, so this dictionary is the analyzer's main
// signal source. The English dictionary in motif-diversity.ts remains
// as a fallback for English drafts.
//
// Shape and conventions:
//   • Categories mirror MotifCategory in motif-diversity.ts so the two
//     dictionaries are drop-in compatible.
//   • Keys are canonical motif labels (snake_case, language-neutral).
//     They appear in telemetry like  weather_nature.wind×3 .
//   • Values are short, curated surface forms — lowercase, including
//     declensions and a few compounds. NO lemmatizer; the matcher does
//     a word-boundary substring scan, so each declined or compound
//     form must be listed explicitly.
//   • Boundary detection in the analyzer treats ä/ö/ü/ß as letters
//     (see countSurfaceForm in motif-diversity.ts), so "ofen" will
//     correctly NOT match inside "schöfen", and "wald" will NOT match
//     inside "wäldern".
//
// Extending the lexicon:
//   • Adding a motif = one new entry in the right category.
//   • Adding a surface form = append to the array of an existing entry.
//   • Keep entries small (≈3–8 surface forms each). If a single motif
//     needs more than ~10 forms, it is probably two motifs in disguise.

import type { MotifCategory } from "./motif-diversity";

export const GERMAN_MOTIF_DICTIONARY: Record<
  MotifCategory,
  Record<string, string[]>
> = {
  weather_nature: {
    wind: ["wind", "winde", "windes", "windig", "windstoß", "windstöße"],
    sturm: ["sturm", "stürme", "stürmen", "stürmisch", "stürmischen"],
    regen: ["regen", "regnerisch", "regennass", "regenwasser", "regnen", "regnet", "regnete"],
    nebel: ["nebel", "nebels", "neblig", "nebelschwaden", "nebelig"],
    schnee: ["schnee", "schnees", "schneefall", "verschneit", "schneien", "schneit"],
    frost: ["frost", "frostes", "frostig", "frostige", "frostiger"],
    kaelte: ["kälte", "kalt", "kalte", "kalter", "kaltes", "kalten", "kühle", "kühl"],
    meer: ["meer", "meere", "meeres", "meereswellen"],
    salzluft: ["salzluft", "salzige luft", "salzig luft"],
    wellen: ["welle", "wellen", "wellenschlag"],
    hafen: ["hafen", "häfen", "hafenmauer", "hafenbecken"],
    kueste: ["küste", "küsten", "küstennah", "küstenlinie"],
    wald: ["wald", "wälder", "waldes", "waldweg", "waldrand"],
    berge: ["berg", "berge", "bergen", "berges", "bergluft"],
    hang: ["hang", "hänge", "hängen", "hänges"],
    tannen: ["tanne", "tannen", "tannenduft", "tannenzweig"],
    glocken: ["glocke", "glocken", "glockenschlag", "glockenklang"],
    herbstlaub: ["herbstlaub", "herbstblätter", "fallende blätter", "fallendes laub"],
  },
  objects: {
    tisch: ["tisch", "tische", "tischen", "tisches", "tischkante"],
    tasse: ["tasse", "tassen"],
    schuessel: ["schüssel", "schüsseln"],
    brief: ["brief", "briefe", "briefes", "briefumschlag"],
    papier: ["papier", "papiere", "papieres"],
    umschlag: ["umschlag", "umschläge", "umschlages"],
    schluessel: ["schlüssel", "schlüssels"],
    fenster: ["fenster", "fenstern", "fensterbank", "fensterrahmen"],
    tuer: ["tür", "türen", "türrahmen", "türschloss"],
    lampe: ["lampe", "lampen", "lampenlicht", "lampenschirm"],
    ofen: ["ofen", "öfen", "ofenwärme", "ofenklappe"],
    kerze: ["kerze", "kerzen", "kerzenlicht", "kerzenschein"],
    radio: ["radio", "radios"],
    foto: ["foto", "fotos", "fotografie", "fotografien"],
    kamera: ["kamera", "kameras"],
    koffer: ["koffer", "kofferdeckel"],
    holz: ["holz", "hölzer", "holzes", "holzbalken"],
    bretter: ["brett", "bretter", "bohlen", "gebälk"],
  },
  smells: {
    kaffee: ["kaffee", "kaffeeduft", "kaffeegeruch"],
    suppe: ["suppe", "suppen", "suppenduft"],
    brot: ["brot", "brote", "brotes", "brotgeruch", "brotduft", "laib"],
    nasses_holz: ["nasses holz", "feuchtes holz", "feuchten holzes"],
    rauch: ["rauch", "raucht", "rauchig", "rauches", "holzrauch"],
    staub: ["staub", "staubig", "staubes", "staubkorn"],
    salz: ["salz", "salzig", "salzige"],
    erde: ["erde", "erdig", "erden", "erdgeruch"],
    kraeuter: ["kraut", "kräuter", "kräutern", "krautduft"],
    teer: ["teer", "teerig"],
    diesel: ["diesel", "dieselgeruch"],
    fisch: ["fisch", "fische", "fischig", "fischgeruch"],
  },
  gestures: {
    blick_senken: [
      "blick senken",
      "senkt den blick",
      "senkte den blick",
      "blick gesenkt",
      "den blick gesenkt",
    ],
    nicken: ["nickt", "nickte", "nicken", "genickt"],
    hand_auf_tisch: [
      "hand auf den tisch",
      "hand auf dem tisch",
      "hände auf dem tisch",
      "hände auf den tisch",
      "die hand auf dem tisch",
    ],
    hand_um_tasse: [
      "hand um die tasse",
      "hände um die tasse",
      "die hand um die tasse",
      "hand um den becher",
    ],
    zum_fenster_sehen: [
      "zum fenster",
      "blickt zum fenster",
      "blickte zum fenster",
      "sah zum fenster",
      "schaute zum fenster",
      "schaut zum fenster",
    ],
    am_fenster_stehen: [
      "am fenster",
      "stand am fenster",
      "steht am fenster",
      "blieb am fenster",
    ],
    kopf_schief_legen: [
      "kopf schief",
      "den kopf schief",
      "neigt den kopf",
      "neigte den kopf",
      "legte den kopf schief",
    ],
    aermel_glatt_streichen: [
      "ärmel glatt",
      "streicht den ärmel",
      "strich den ärmel",
      "streicht die ärmel",
    ],
    haende_falten: [
      "hände falten",
      "faltet die hände",
      "faltete die hände",
      "gefaltete hände",
      "die hände gefaltet",
    ],
    schultern_heben: [
      "schultern heben",
      "hebt die schultern",
      "hob die schultern",
      "zuckt mit den schultern",
      "zuckte mit den schultern",
    ],
    ausatmen: ["ausatmen", "atmet aus", "atmete aus", "ausatmend"],
  },
  silence_closure: {
    schweigen: ["schweigen", "schweigt", "schwieg", "geschwiegen"],
    stille: ["stille", "still", "ganz still", "stillen"],
    waerme: ["wärme", "warm", "warmer", "warmes", "warme", "warmen"],
    licht: ["licht", "lichter", "lichtschein", "lampenlicht"],
    abend: ["abend", "abende", "abends", "abendlich", "abendrot"],
    daemmerung: ["dämmerung", "dämmrig", "dämmrige", "dämmernd"],
    heimkehr: ["heimkehr", "heimgekehrt", "heimkehrt", "nach hause"],
    schwelle: ["schwelle", "schwellen", "türschwelle", "an der schwelle"],
  },
};
