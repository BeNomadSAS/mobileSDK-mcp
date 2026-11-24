/**
 * @file Guide sections: the heading slugs that serve as section ids, the heading list, and section lookup.
 *
 * Shared by the generator, which cuts the guides into sections, and the server, which finds the section an
 * assistant asks for.
 */

import { tokenize } from './tokenize.js';

/** @typedef {import('./types.js').Guide} Guide */
/** @typedef {import('./types.js').GuideSection} GuideSection */

/**
 * Turns a heading into a slug.
 *
 * @param {string} title Heading text.
 * @returns {string} Lower-case words joined by hyphens; Markdown punctuation and code ticks removed.
 */
export function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[`*_~[\]()]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'section';
}

/**
 * Lists the ATX headings of a Markdown text, ignoring lines inside fenced code blocks.
 *
 * @param {string} text Markdown text with `\n` line ends.
 * @returns {{level: number, title: string, offset: number}[]} Headings in order.
 */
export function listHeadings(text) {
    /** @type {{level: number, title: string, offset: number}[]} */
    const headings = [];
    let fence = null;
    let offset = 0;
    for (const line of text.split('\n')) {
        const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (fenceMatch) {
            if (!fence) fence = fenceMatch[1][0];
            else if (fenceMatch[1][0] === fence) fence = null;
        } else if (!fence) {
            const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
            if (h) headings.push({ level: h[1].length, title: h[2].trim(), offset });
        }
        offset += line.length + 1;
    }
    return headings;
}

/**
 * Finds a section of a guide by id or by (partial, case-insensitive) title.
 *
 * @param {Guide} guide The guide.
 * @param {string} query Section id, exact title, or words of the title.
 * @returns {GuideSection|null} The best match: exact id, then exact title, then the first title containing the query,
 *   then the section whose title holds every word of the query once reduced to search stems. The last step accepts
 *   British and American spellings and plurals alike: "core-initialisation" finds "Core initialization".
 */
export function findSection(guide, query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const slug = slugify(q);
    return (
        guide.sections.find((s) => s.id === q || s.id === slug) ??
        guide.sections.find((s) => s.title.toLowerCase() === q) ??
        guide.sections.find((s) => s.title.toLowerCase().includes(q) || s.id.includes(slug)) ??
        findSectionByStems(guide, q)
    );
}

/**
 * Finds the section whose title holds every stem of the query; among several, the one with the fewest other words.
 *
 * @param {Guide} guide The guide.
 * @param {string} query The query, lower case; hyphens separate words, as in section ids.
 * @returns {GuideSection|null} The section, or `null`.
 */
function findSectionByStems(guide, query) {
    const wanted = new Set(tokenize(query.replace(/-/g, ' ')));
    if (!wanted.size) return null;
    let best = null;
    let bestExtra = Infinity;
    for (const section of guide.sections) {
        const words = new Set(tokenize(section.title));
        if (![...wanted].every((w) => words.has(w))) continue;
        const extra = words.size - wanted.size;
        if (extra < bestExtra) {
            best = section;
            bestExtra = extra;
        }
    }
    return best;
}
