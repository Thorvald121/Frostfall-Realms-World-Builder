// lib/domain/categories.js
//
// Frostfall Realms — Category & Field Constants (Single Source of Truth)
// Used by FrostfallRealms.jsx, IntegrityPanel.jsx, and all future feature modules.

export const CATEGORIES = {
  deity: { label: "Deity", icon: "☀", color: "#f0c040" },
  race: { label: "Race / Species", icon: "🜃", color: "#7ec8e3" },
  character: { label: "Character", icon: "👤", color: "#e8a050" },
  event: { label: "Historical Event", icon: "⚔", color: "#e07050" },
  location: { label: "Location", icon: "📍", color: "#8ec8a0" },
  organization: { label: "Organization", icon: "🏛", color: "#a088d0" },
  item: { label: "Item / Artifact", icon: "⚒", color: "#d4a060" },
  magic: { label: "Magic / Lore", icon: "✦", color: "#c084fc" },
  language: { label: "Language", icon: "🗣", color: "#e0c878" },
  flora_fauna: { label: "Flora & Fauna", icon: "🌿", color: "#6db88f" },
  laws_customs: { label: "Laws & Customs", icon: "📜", color: "#c8a878" },
};

export function categoryPluralLabel(cat) {
  const special = {
    deity: "Deities",
    race: "Races / Species",
    character: "Characters",
    event: "Historical Events",
    location: "Locations",
    organization: "Organizations",
    item: "Items / Artifacts",
    magic: "Magic / Lore",
    language: "Languages",
    flora_fauna: "Flora & Fauna",
    laws_customs: "Laws & Customs",
  };
  if (special[cat]) return special[cat];
  const base = CATEGORIES?.[cat]?.label ?? "";
  const t = String(base || "").trim();
  if (!t) return "";
  return /s$/i.test(t) ? t : t + "s";
}

export const ERAS = [
  { id: "primordial", label: "Primordial Era", start: -10000, end: 0, color: "#c084fc", bg: "rgba(192,132,252,0.06)" },
  { id: "first_age", label: "First Age — Awakening", start: 0, end: 1000, color: "#f0c040", bg: "rgba(240,192,64,0.06)" },
  { id: "second_age", label: "Second Age — Kingdoms", start: 1000, end: 2817, color: "#7ec8e3", bg: "rgba(126,200,227,0.06)" },
  { id: "third_age", label: "Third Age — Division", start: 2817, end: 4500, color: "#e07050", bg: "rgba(224,112,80,0.06)" },
];

export const SWIM_LANE_ORDER = [
  "deity", "magic", "race", "character", "event",
  "location", "organization", "item", "language",
  "flora_fauna", "laws_customs",
];

export const FIELD_LABELS = {
  // Deity fields
  domain: "Domain", symbol: "Holy Symbol", court: "Divine Court", sacred_time: "Sacred Time",
  worshippers: "Worshippers", gift_to_mortals: "Gift to Mortals", creators: "Creator Gods",
  // Race fields
  lifespan: "Lifespan", population: "Population", magic_affinity: "Magic Affinity",
  homeland: "Homeland", capital: "Capital", major_clans: "Major Clans",
  defining_trait: "Defining Trait",
  // Event fields
  date_range: "Date Range", age: "Age / Era",
  casualties: "Casualties", key_figures: "Key Figures", outcome: "Outcome",
  // Shared / generic
  type: "Type", origin: "Origin", scope: "Scope", cost_types: "Cost Types",
  violation_consequence: "Violation Consequence", counterpart: "Counterpart",
  current_state: "Current State", legacy: "Legacy", current_age: "Current Age",
  notable_regions: "Notable Regions", physical_characteristics: "Physical Characteristics",
  // Character fields
  char_race: "Race", birth_year: "Birth Year", death_year: "Death Year",
  titles: "Titles", affiliations: "Affiliations", role: "Role",
  // Location fields
  region: "Region", ruler: "Ruler", founding_year: "Founded",
  notable_features: "Notable Features", status: "Status",
  // Organization fields
  founded: "Founded", leader: "Leader", headquarters: "Headquarters",
  purpose: "Purpose", members: "Key Members",
  // Item fields
  creator: "Creator", current_location: "Current Location",
  power: "Power / Ability", history: "History",
  // Language fields
  speakers: "Speakers", script: "Script / Writing System", lang_origin: "Origin",
  sample_phrases: "Sample Phrases", grammar_notes: "Grammar Notes", lang_status: "Status",
  // Flora & Fauna fields
  species_type: "Type", habitat: "Habitat", rarity: "Rarity",
  uses: "Uses / Properties", danger_level: "Danger Level", description: "Description",
  // Laws & Customs fields
  custom_type: "Type", enforced_by: "Enforced By", applies_to: "Applies To",
  penalties: "Penalties", cultural_significance: "Cultural Significance", exceptions: "Exceptions",
};

// Universal field key formatter — never show raw underscored keys to users
export function formatKey(k) {
  return FIELD_LABELS[k] || String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const TEMPLATE_FIELDS = {
  deity: ["domain", "symbol", "court", "sacred_time", "worshippers", "gift_to_mortals"],
  race: ["creators", "lifespan", "population", "magic_affinity", "homeland", "capital"],
  character: ["char_race", "birth_year", "death_year", "titles", "affiliations", "role"],
  event: ["date_range", "age", "casualties", "key_figures", "outcome"],
  location: ["region", "ruler", "population", "founding_year", "notable_features", "status"],
  organization: ["type", "founded", "leader", "headquarters", "purpose", "members"],
  item: ["type", "creator", "current_location", "power", "history"],
  magic: ["type", "origin", "scope", "cost_types", "violation_consequence"],
  language: ["speakers", "script", "lang_origin", "sample_phrases", "grammar_notes", "lang_status"],
  flora_fauna: ["species_type", "habitat", "rarity", "uses", "danger_level", "description"],
  laws_customs: ["custom_type", "enforced_by", "applies_to", "penalties", "cultural_significance", "exceptions"],
};

// --- UI & Settings Constants ---

export const FONT_SIZES = { compact: 0.88, default: 1.0, large: 1.14 };

export const EDITOR_FONTS = {
  georgia: "'Georgia', serif",
  times: "'Times New Roman', Times, serif",
  palatino: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'Fira Code', 'Consolas', monospace",
};

export const DEFAULT_SETTINGS = {
  theme: "dark_arcane",
  fontSize: "default",
  editorFont: "georgia",
  disabledCategories: [],
  disabledFeatures: [],
  integritySensitivity: "balanced",
  eraLabel: "Year",
  customEras: [],
  authorName: "",
  avatarUrl: "",
  aiProvider: "anthropic",
  aiKeys: {},
  aiModel: {},
  spellCheck: true,
  autoCorrect: true,
};

export const FEATURE_MODULES = [
  { id: "timeline", icon: "⏳", label: "Timeline", description: "Chronological view of world events" },
  { id: "graph", icon: "◉", label: "Relationship Web", description: "Visual graph of entity connections" },
  { id: "family_tree", icon: "🌳", label: "Family Tree", description: "Character lineage and family ties" },
  { id: "map", icon: "🗺", label: "Map Builder", description: "Interactive world map with pins" },
  { id: "novel", icon: "✒", label: "Novel Writing", description: "Scene-based manuscript editor" },
  { id: "generator", icon: "🎲", label: "Generators", description: "Random NPC, location, and plot generators" },
  { id: "sessions", icon: "📓", label: "Session Notes", description: "Campaign session logging for DMs" },
];