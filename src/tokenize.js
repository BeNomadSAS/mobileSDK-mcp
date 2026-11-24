/**
 * @file Tokenizer shared by the search index and the queries.
 *
 * API names and prose are searched together, so the tokenizer:
 * - splits identifiers at case changes, digits and separators (`createPOICluster` gives `create`, `poi`,
 *   `cluster`), and also keeps the whole identifier (`createpoicluster`) so that an exact name ranks first;
 * - lower-cases, drops English stop words, and maps British spellings to American ones (`initialise` and
 *   `initialize` are one term: the MSDK documentation uses both);
 * - applies a light stemmer (plurals, `-ing`, `-ed`, `-ize`/`-ization`), so that "initialization",
 *   "initializes" and "initialize" meet;
 * - expands a few abbreviations used in names (`init` is also `initial...`).
 *
 * The same function runs on the documents and on the queries, so any normalization stays consistent: a word that
 * is stemmed oddly is stemmed oddly on both sides and still matches.
 */

/** Words too common to help ranking. */
const STOP_WORDS = new Set(
    ('a an and are as at be by can do does for from has have how i if in into is it its of on or that the their '
        + 'then there these this to was what when where which while who why will with you your').split(' '),
);

/**
 * Words that users and the documentation use for the same thing. Applied to queries only, at a reduced weight,
 * so that "show a marker" also finds "display a POI".
 */
export const SYNONYMS = new Map(Object.entries({
    show: ['display'], display: ['show'],
    marker: ['poi', 'pin'], pin: ['poi', 'marker'], poi: ['marker'],
    remove: ['delete'], delete: ['remove'],
    position: ['location'], location: ['position'], gps: ['location'],
    callback: ['listener', 'observer'], listener: ['callback', 'observer'], observer: ['listener', 'callback'],
    initialize: ['init'], initialise: ['init'], init: ['initialize'], setup: ['initialize'],
    ev: ['electric'], electric: ['ev'],
    itinerary: ['route'], directions: ['route', 'guidance'],
    car: ['vehicle'], vehicle: ['car'],
}));

/** Abbreviations found in API names, with the stem of the word they stand for. */
const ABBREVIATIONS = new Map([
    ['init', 'initial'],
    ['config', 'configur'],
    ['nav', 'navigat'],
    ['pos', 'position'],
    ['poi', 'poi'],
]);

/**
 * Reduces a lower-case word to its search stem.
 *
 * @param {string} word A lower-case word of letters and digits.
 * @returns {string} The stem.
 */
export function stem(word) {
    let w = word;
    if (w.length <= 3 || /\d/.test(w)) return w;
    // 1. British spellings, so that both spellings reach the same stem.
    w = w.replace(/isation(s?)$/, 'ization$1').replace(/is(e|es|ed|ing)$/, 'iz$1').replace(/our$/, 'or');
    // 2. Noun suffixes and plurals (first match only).
    if (/izations?$/.test(w)) w = w.replace(/izations?$/, '');
    else if (/urations?$/.test(w)) w = w.replace(/urations?$/, 'ur');
    else if (/ations?$/.test(w) && w.length > 7) w = w.replace(/ations?$/, 'at');
    else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    // 3. Verb suffixes (first match only).
    if (/iz(e|ed|es|ing)$/.test(w) && w.length > 6) w = w.replace(/iz(e|ed|es|ing)$/, '');
    else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
    else if (w.endsWith('ed') && !w.endsWith('eed') && w.length > 4) w = w.slice(0, -2);
    // 4. Agent nouns, so that "geocoder" meets "geocoding" and "listener" meets "listening".
    if (w.endsWith('er') && w.length > 5) w = w.slice(0, -2);
    // 5. A final "e", so that "enable", "enabled" and "enables" meet ("enabl").
    if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
    return w;
}

/**
 * Splits an identifier at case changes and digit boundaries.
 *
 * @param {string} word A word of letters and digits (no separators).
 * @returns {string[]} Its parts, original case (for example `getPOIList` gives `get`, `POI`, `List`).
 */
export function splitIdentifier(word) {
    return word
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([A-Za-z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([A-Za-z])/g, '$1 $2')
        .split(' ')
        .filter(Boolean);
}

/**
 * Turns a text into search terms.
 *
 * @param {string} text Any text: a query, a signature, a documentation paragraph.
 * @returns {string[]} The terms, in order, with repeats (term frequency matters for ranking).
 */
export function tokenize(text) {
    /** @type {string[]} */
    const terms = [];
    for (const word of (text ?? '').split(/[^A-Za-z0-9]+/)) {
        if (!word) continue;
        const parts = splitIdentifier(word);
        if (parts.length > 1) {
            // The whole identifier is a term of its own: exact names score higher than their parts.
            const whole = word.toLowerCase();
            if (whole.length > 2) terms.push(whole);
        }
        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower.length < 2 || STOP_WORDS.has(lower)) continue;
            const s = stem(lower);
            terms.push(s);
            const expansion = ABBREVIATIONS.get(lower);
            if (expansion && expansion !== s) terms.push(expansion);
        }
    }
    return terms;
}
