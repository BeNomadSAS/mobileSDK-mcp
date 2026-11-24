/**
 * @file In-memory BM25 search index with weighted fields.
 *
 * The corpus is small (a few thousand declarations and guide sections), so the server builds the index when it
 * starts, in well under a second. That avoids shipping an index file that could drift from the corpus.
 *
 * Scoring is Okapi BM25 over a weighted bag of words: each field of a document adds its terms with the field's
 * weight (a name counts more than a paragraph), and the weighted counts play the role of term frequencies.
 * A query term absent from the vocabulary is expanded to the vocabulary terms it prefixes ("navig" finds
 * "navigat..."), at a reduced weight.
 */

import { SYNONYMS, tokenize } from './tokenize.js';

/**
 * A field of a document to index.
 *
 * @typedef {object} IndexField
 * @property {string} text The field text.
 * @property {number} weight How much each occurrence of a term counts (1 for plain text).
 */

/**
 * A search hit.
 *
 * @typedef {object} IndexHit
 * @property {number} doc Index of the document, in the order of {@link SearchIndex#add} calls.
 * @property {number} score BM25 score (higher is better).
 */

export class SearchIndex {
    /**
     * Creates an empty index.
     *
     * @param {{k1?: number, b?: number, maxExpansions?: number, expansionWeight?: number, synonymWeight?: number}}
     *   [options] BM25 parameters (`k1` term-frequency saturation, `b` length normalization), the prefix expansion
     *   settings and the weight of query synonyms.
     */
    constructor({ k1 = 1.2, b = 0.5, maxExpansions = 20, expansionWeight = 0.5, synonymWeight = 0.6 } = {}) {
        this.k1 = k1;
        // b below the usual 0.75: the key declarations (Core.init...) have the longest documentation, and a strong
        // length normalization would push them down.
        this.b = b;
        this.maxExpansions = maxExpansions;
        this.expansionWeight = expansionWeight;
        this.synonymWeight = synonymWeight;
        /** @type {number[]} Weighted length of each document. */
        this.lengths = [];
        /** @type {Map<string, Array<[number, number]>>} Term to postings `[doc, weighted frequency]`. */
        this.postings = new Map();
        /** @type {Map<string, number>} Inverse document frequency of each term, computed by {@link finalize}. */
        this.idf = new Map();
        /** @type {string[]} Sorted vocabulary, for prefix expansion. */
        this.vocabulary = [];
        this.averageLength = 0;
        this.finalized = false;
    }

    /**
     * Adds a document.
     *
     * @param {IndexField[]} fields The document fields.
     * @returns {number} The document index, used in hits.
     */
    add(fields) {
        if (this.finalized) throw new Error('The index is finalized');
        const doc = this.lengths.length;
        /** @type {Map<string, number>} */
        const frequencies = new Map();
        let length = 0;
        for (const { text, weight } of fields) {
            if (!text || weight <= 0) continue;
            for (const term of tokenize(text)) {
                frequencies.set(term, (frequencies.get(term) ?? 0) + weight);
                length += weight;
            }
        }
        this.lengths.push(length);
        for (const [term, frequency] of frequencies) {
            let list = this.postings.get(term);
            if (!list) {
                list = [];
                this.postings.set(term, list);
            }
            list.push([doc, frequency]);
        }
        return doc;
    }

    /**
     * Computes the statistics that scoring needs. Call once, after the last {@link add}.
     */
    finalize() {
        const n = this.lengths.length;
        this.averageLength = n ? this.lengths.reduce((a, b) => a + b, 0) / n : 0;
        for (const [term, list] of this.postings) {
            const df = list.length;
            this.idf.set(term, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
        }
        this.vocabulary = [...this.postings.keys()].sort();
        this.finalized = true;
    }

    /**
     * Returns the vocabulary terms that start with a prefix.
     *
     * @param {string} prefix The prefix (at least 3 characters).
     * @returns {string[]} Up to `maxExpansions` terms, the prefix itself excluded.
     */
    expand(prefix) {
        if (prefix.length < 3) return [];
        // Binary search for the first term >= prefix.
        let lo = 0;
        let hi = this.vocabulary.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.vocabulary[mid] < prefix) lo = mid + 1;
            else hi = mid;
        }
        /** @type {string[]} */
        const out = [];
        for (let i = lo; i < this.vocabulary.length && out.length < this.maxExpansions; i++) {
            const term = this.vocabulary[i];
            if (!term.startsWith(prefix)) break;
            if (term !== prefix) out.push(term);
        }
        return out;
    }

    /**
     * Turns a query into weighted index terms: its own terms (weight 1), their synonyms, and, for a term the
     * vocabulary does not know, the terms it prefixes.
     *
     * @param {string} query The query text.
     * @returns {Map<string, number>} Index term to weight.
     */
    queryTerms(query) {
        /** @type {Map<string, number>} */
        const terms = new Map();
        const put = (term, weight) => terms.set(term, Math.max(terms.get(term) ?? 0, weight));
        for (const word of query.toLowerCase().split(/[^a-z0-9]+/)) {
            for (const synonym of SYNONYMS.get(word) ?? []) {
                for (const term of tokenize(synonym)) if (this.postings.has(term)) put(term, this.synonymWeight);
            }
        }
        for (const term of tokenize(query)) {
            if (this.postings.has(term)) put(term, 1);
            else for (const expanded of this.expand(term)) put(expanded, this.expansionWeight);
        }
        return terms;
    }

    /**
     * Scores every document against a query.
     *
     * @param {string} query The query text.
     * @returns {Float64Array} One score per document (0 when no term matches).
     */
    scoreAll(query) {
        if (!this.finalized) throw new Error('Call finalize() before searching');
        const scores = new Float64Array(this.lengths.length);
        const terms = this.queryTerms(query);
        const { k1, b, averageLength } = this;
        for (const [term, weight] of terms) {
            const idf = this.idf.get(term) ?? 0;
            for (const [doc, frequency] of this.postings.get(term) ?? []) {
                const norm = k1 * (1 - b + (b * this.lengths[doc]) / (averageLength || 1));
                scores[doc] += weight * idf * ((frequency * (k1 + 1)) / (frequency + norm));
            }
        }
        return scores;
    }

    /**
     * Searches the index.
     *
     * @param {string} query The query text.
     * @param {{limit?: number, filter?: (doc: number) => boolean, boost?: (doc: number, score: number) => number}}
     *   [options] Maximum number of hits, a document filter, and a function that adjusts each positive score.
     * @returns {IndexHit[]} Hits by decreasing score.
     */
    search(query, { limit = 10, filter = () => true, boost = (_doc, score) => score } = {}) {
        const scores = this.scoreAll(query);
        /** @type {IndexHit[]} */
        const hits = [];
        for (let doc = 0; doc < scores.length; doc++) {
            if (scores[doc] > 0 && filter(doc)) hits.push({ doc, score: boost(doc, scores[doc]) });
        }
        hits.sort((x, y) => y.score - x.score || x.doc - y.doc);
        return hits.slice(0, limit);
    }
}
