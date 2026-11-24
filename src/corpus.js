/**
 * @file The corpus as the server uses it: the exported records and guides, their lookup tables and the search index.
 *
 * The server loads the corpus once at start-up from the `data/` folder of the package, next to `src/` (`api.json`,
 * `guides.json` and `meta.json`, written by the export step), then answers every tool call from memory. Nothing is
 * fetched over the network.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SearchIndex } from './search.js';
import { SYNONYMS, splitIdentifier, tokenize } from './tokenize.js';

/** @typedef {import('./types.js').ApiRecord} ApiRecord */
/** @typedef {import('./types.js').Guide} Guide */
/** @typedef {import('./types.js').GuideSection} GuideSection */

/** Corpus format the server understands (see `CORPUS_SCHEMA` in the export). */
export const SUPPORTED_SCHEMA = 1;

/** Kinds that denote a type (a page with members). */
export const TYPE_KINDS = new Set(['class', 'interface', 'object', 'enum', 'annotation', 'typealias']);

/** Every kind a search can be restricted to. `type` groups the type kinds; `guide` selects guide sections. */
export const SEARCH_KINDS = [
    'type', 'class', 'interface', 'object', 'enum', 'enum-entry', 'constructor', 'function', 'property', 'guide',
];

/**
 * Prior weight of each kind: what developers look for first. Error-code enum entries are numerous and match
 * many words, so they come after functions and types unless the query names them.
 */
const KIND_PRIOR = {
    class: 1, interface: 1, object: 1, enum: 1, annotation: 0.9, typealias: 0.9,
    function: 1, property: 0.9, constructor: 0.8, 'enum-entry': 0.6, member: 0.8,
};

/** Generated or inherited members that rarely answer a question: ranked lower. */
const BOILERPLATE_NAMES = new Set([
    'equals', 'hashCode', 'toString', 'valueOf', 'values', 'entries', 'copy', 'describeContents', 'writeToParcel',
    'name', 'ordinal', 'CREATOR',
]);

/**
 * A search result.
 *
 * @typedef {object} SearchHit
 * @property {'api'|'guide'} type What was found.
 * @property {number} score Relevance (higher is better); comparable within one search only.
 * @property {ApiRecord} [record] The declaration, for `api` hits.
 * @property {Guide} [guide] The guide, for `guide` hits.
 * @property {GuideSection|null} [section] The guide section, for `guide` hits; `null` for the guide introduction.
 */

export class Corpus {
    /**
     * Loads a corpus folder.
     *
     * @param {string} dir Folder holding `meta.json`, `api.json` and `guides.json`.
     * @returns {Corpus} The loaded corpus, indexed.
     * @throws {Error} When a file is missing or the corpus format is not supported.
     */
    static load(dir) {
        const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
        return new Corpus({ meta: read('meta.json'), records: read('api.json'), guides: read('guides.json') });
    }

    /**
     * Builds the lookup tables and the search index.
     *
     * @param {{meta: any, records: ApiRecord[], guides: Guide[]}} data The corpus content.
     */
    constructor({ meta, records, guides }) {
        if (meta?.schema !== SUPPORTED_SCHEMA) {
            throw new Error(`Unsupported corpus schema ${meta?.schema}; this server reads schema ${SUPPORTED_SCHEMA}`);
        }
        this.meta = meta;
        this.records = records;
        this.guides = guides;

        /** @type {Map<string, ApiRecord>} */
        this.byId = new Map(records.map((r) => [r.id, r]));
        /** @type {Map<string, ApiRecord[]>} Fully qualified name to its records (overloads). */
        this.byFqn = new Map();
        /** @type {Map<string, ApiRecord[]>} Lower-case simple name to records. */
        this.byName = new Map();
        for (const r of records) {
            push(this.byFqn, r.fqn, r);
            push(this.byName, r.name.toLowerCase(), r);
        }
        /** @type {Map<string, Guide>} Lower-case guide name to guide. */
        this.guidesByName = new Map(guides.map((g) => [g.name.toLowerCase(), g]));

        // One search document per declaration, per guide introduction and per guide section (own text only).
        // Each document also keeps the concepts of its name (or title), for the name boost of search().
        /** @type {Array<({type: 'api', record: ApiRecord} | {type: 'guide', guide: Guide, section: GuideSection|null}) & {concepts: Set<string>[]}>} */
        this.documents = [];
        this.index = new SearchIndex();
        for (const r of records) {
            const parentName = r.parent ? r.parent.slice(r.parent.lastIndexOf('.') + 1) : '';
            this.documents.push({ type: 'api', record: r, concepts: nameConcepts(`${r.name} ${parentName}`) });
            this.index.add([
                { text: r.name, weight: 4 },
                { text: parentName, weight: 1.5 },
                { text: r.summary, weight: 2 },
                { text: r.signature, weight: 1 },
                { text: r.doc, weight: 1 },
                { text: r.params.map((p) => `${p.name} ${p.doc ?? ''}`).join(' '), weight: 0.5 },
                { text: r.returns ?? '', weight: 0.5 },
            ]);
        }
        for (const g of guides) {
            const introEnd = g.sections.length ? g.sections[0].start : g.text.length;
            this.documents.push({ type: 'guide', guide: g, section: null, concepts: nameConcepts(g.title) });
            this.index.add([
                { text: g.title, weight: 3 },
                { text: g.text.slice(0, introEnd), weight: 1 },
            ]);
            for (const s of g.sections) {
                this.documents.push({ type: 'guide', guide: g, section: s, concepts: nameConcepts(`${s.title} ${g.module ?? ''}`) });
                this.index.add([
                    { text: s.title, weight: 3 },
                    { text: g.title, weight: 0.5 },
                    { text: g.text.slice(s.start, s.ownEnd), weight: 1 },
                ]);
            }
        }
        this.index.finalize();
    }

    /**
     * Lists the module names of the corpus.
     *
     * @returns {string[]} Module names, in corpus order.
     */
    moduleNames() {
        return this.meta.modules.map((m) => m.name);
    }

    /**
     * Searches declarations and guides.
     *
     * @param {string} query Words, names or a question.
     * @param {{module?: string, kind?: string, limit?: number}} [options] Restrict to one module (case-insensitive)
     *   or one kind (see {@link SEARCH_KINDS}); maximum number of hits.
     * @returns {SearchHit[]} Hits by decreasing relevance.
     */
    search(query, { module, kind, limit = 10 } = {}) {
        const wantedModule = module?.toLowerCase();
        const q = query.trim();
        const qLower = q.toLowerCase();
        const filter = (doc) => {
            const d = this.documents[doc];
            const docModule = d.type === 'api' ? d.record.module : d.guide.module;
            if (wantedModule && docModule?.toLowerCase() !== wantedModule) return false;
            if (!kind) return true;
            if (kind === 'guide') return d.type === 'guide';
            if (d.type !== 'api') return false;
            return kind === 'type' ? TYPE_KINDS.has(d.record.kind) : d.record.kind === kind;
        };
        const groups = queryGroups(q);
        const boost = (doc, score) => {
            const d = this.documents[doc];
            // Query words found in the name of a declaration (or of its type), or in a guide section title, weigh
            // most: "initialize Core" is about Core.init and the "Core initialization" section more than about a
            // declaration whose documentation happens to mention both words.
            const nameFactor = nameBoost(groups, d.concepts);
            if (d.type !== 'api') return score * nameFactor;
            const r = d.record;
            let s = score * nameFactor * (KIND_PRIOR[r.kind] ?? 1);
            // A query that names the declaration ("init", "Core.init", the full name) puts it first.
            const parentName = r.parent ? r.parent.slice(r.parent.lastIndexOf('.') + 1) : '';
            if (q === r.fqn || q === r.id || (parentName && q === `${parentName}.${r.name}`)) s = s * 3 + 20;
            else if (qLower === r.name.toLowerCase()) s = s * 2 + 10;
            if (r.deprecated !== null) s *= 0.6;
            if (BOILERPLATE_NAMES.has(r.name) || /^component\d+$/.test(r.name)) s *= 0.3;
            return s;
        };
        return this.index.search(q, { limit, filter, boost }).map(({ doc, score }) => ({ ...this.documents[doc], score }));
    }

    /**
     * Finds declarations by id or name.
     *
     * Accepted forms, tried in this order: an id from a search (`com.example.Type.member(Int)`), a fully qualified
     * name (every overload), a qualified suffix (`Core.init`, `MapView.createPOICluster`), a simple name (exact
     * case first, then any case).
     *
     * A simple name that names a type returns the type, not also its constructors, which share the type's name:
     * asking for `Core` means the class, whose answer lists its constructors among its members. `Core.Core` or a
     * constructor id still reaches a constructor.
     *
     * @param {string} query The id or name.
     * @returns {ApiRecord[]} Matching declarations; empty when nothing matches.
     */
    resolve(query) {
        const q = query.trim().replace(/^`|`$/g, '');
        if (!q) return [];
        const byId = this.byId.get(q);
        if (byId) return [byId];
        const fqn = q.replace(/\(.*\)$/, '');
        const byFqn = this.byFqn.get(fqn);
        if (byFqn) return byFqn;
        if (fqn.includes('.')) {
            const suffix = `.${fqn}`;
            const bySuffix = this.records.filter((r) => r.fqn.endsWith(suffix));
            if (bySuffix.length) return bySuffix;
        }
        const named = this.byName.get(fqn.toLowerCase()) ?? [];
        const exactCase = named.filter((r) => r.name === fqn);
        return withoutConstructorsOfTypes(exactCase.length ? exactCase : named);
    }

    /**
     * Returns the members of a type, from its record's member list.
     *
     * @param {ApiRecord} record A type record.
     * @returns {ApiRecord[]} The member records that the export could resolve.
     */
    membersOf(record) {
        return record.members.map((m) => (m.ref ? this.byId.get(m.ref) : undefined)).filter(Boolean);
    }

    /**
     * Finds a guide by name, module or title (case-insensitive).
     *
     * @param {string} name `overview`, a module name (`Core`) or the name of a curated guide.
     * @returns {Guide|null} The guide.
     */
    guide(name) {
        const q = name.trim().toLowerCase();
        return (
            this.guidesByName.get(q) ??
            this.guides.find((g) => g.module?.toLowerCase() === q || g.title.toLowerCase() === q) ??
            null
        );
    }

    /**
     * Builds the public URL of a declaration's page in the published API reference.
     *
     * @param {ApiRecord} record The declaration.
     * @returns {string|null} The URL, or `null` when this build's reference is not published.
     */
    docsUrl(record) {
        return this.meta.docsBaseUrl ? `${this.meta.docsBaseUrl}/${record.location}` : null;
    }
}

/**
 * Drops, from name matches, the constructors of the types that are also among the matches.
 *
 * @param {ApiRecord[]} matches Declarations that share a simple name.
 * @returns {ApiRecord[]} The matches, without the constructors whose type is listed.
 */
function withoutConstructorsOfTypes(matches) {
    const types = new Set(matches.filter((r) => TYPE_KINDS.has(r.kind)).map((r) => r.fqn));
    return types.size ? matches.filter((r) => !(r.kind === 'constructor' && types.has(r.parent))) : matches;
}

/**
 * Splits a name or a title into concepts: one set of search terms per word part (a stem and, for an abbreviation,
 * its expansion). Duplicate concepts are dropped.
 *
 * @param {string} text A declaration name with its type name, or a section title.
 * @returns {Set<string>[]} The concepts.
 */
export function nameConcepts(text) {
    /** @type {Map<string, Set<string>>} */
    const out = new Map();
    for (const word of text.split(/[^A-Za-z0-9]+/)) {
        for (const part of splitIdentifier(word)) {
            const terms = new Set(tokenize(part));
            if (terms.size) out.set([...terms].sort().join(' '), terms);
        }
    }
    return [...out.values()];
}

/**
 * Splits a query into word groups: the search terms of each word part, plus those of its synonyms.
 *
 * @param {string} query The query.
 * @returns {Set<string>[]} One group per meaningful word part (stop words dropped).
 */
export function queryGroups(query) {
    /** @type {Set<string>[]} */
    const groups = [];
    for (const word of query.split(/[^A-Za-z0-9]+/)) {
        for (const part of splitIdentifier(word)) {
            const terms = new Set(tokenize(part));
            if (!terms.size) continue;
            for (const synonym of SYNONYMS.get(part.toLowerCase()) ?? []) for (const t of tokenize(synonym)) terms.add(t);
            groups.push(terms);
        }
    }
    return groups;
}

/**
 * Computes the name boost of a document: 1 plus the share of query words found in its name (recall) plus the share
 * of its name found in the query (precision). A short name fully covered by the query ("Core.init" for "initialize
 * Core") scores highest, up to 3.
 *
 * @param {Set<string>[]} groups Query word groups (see {@link queryGroups}).
 * @param {Set<string>[]} concepts Name concepts of the document (see {@link nameConcepts}).
 * @returns {number} A factor between 1 and 3.
 */
export function nameBoost(groups, concepts) {
    if (!groups.length || !concepts.length) return 1;
    const meets = (a, b) => {
        for (const x of a) if (b.has(x)) return true;
        return false;
    };
    const recall = groups.filter((g) => concepts.some((c) => meets(g, c))).length / groups.length;
    const precision = concepts.filter((c) => groups.some((g) => meets(g, c))).length / concepts.length;
    return 1 + recall + precision;
}

/**
 * Appends a value to the list stored under a key of a map.
 *
 * @template K, V
 * @param {Map<K, V[]>} map The map.
 * @param {K} key The key.
 * @param {V} value The value.
 */
function push(map, key, value) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}
