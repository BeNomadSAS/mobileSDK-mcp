/**
 * @file Renders corpus content as the Markdown text that the tools return.
 *
 * Every answer stands on its own: it names the declaration, its module and its id, so that an assistant can quote
 * it or ask for more without having seen earlier answers (clients of the 2026-07-28 protocol may also skip the
 * server instructions, so nothing relies on them).
 */

import { findSection } from './sections.js';
import { TYPE_KINDS } from './corpus.js';

/** @typedef {import('./corpus.js').Corpus} Corpus */
/** @typedef {import('./corpus.js').SearchHit} SearchHit */
/** @typedef {import('./types.js').ApiRecord} ApiRecord */
/** @typedef {import('./types.js').Guide} Guide */
/** @typedef {import('./types.js').GuideSection} GuideSection */

/** Largest answer, in characters (about 30 KB): beyond it, the answer is cut with a hint to narrow the request. */
export const MAX_ANSWER_CHARS = 30_000;

/** Members listed for one type before the list is cut. */
export const MAX_MEMBERS = 150;

/** Guides longer than this are answered with their table of contents unless a section is asked for. */
export const GUIDE_TOC_THRESHOLD = 12_000;

/**
 * Cuts an answer that is too long, at a line boundary, and says how to get the rest.
 *
 * @param {string} text The answer.
 * @param {string} hint What to do to get the rest (for example "ask for one section").
 * @param {number} [max=MAX_ANSWER_CHARS] Maximum length.
 * @returns {string} The answer, cut if needed.
 */
export function capAnswer(text, hint, max = MAX_ANSWER_CHARS) {
    if (text.length <= max) return text;
    const cut = text.lastIndexOf('\n', max - 200);
    let head = text.slice(0, cut > 0 ? cut : max - 200);
    // Do not leave a code fence open.
    if ((head.match(/^```/gm) ?? []).length % 2 === 1) head += '\n```';
    return `${head}\n\n[Answer cut at ${max} characters: ${hint}.]`;
}

/**
 * Returns the short display name of a declaration: `Type.member`, or the type name.
 *
 * @param {ApiRecord} record The declaration.
 * @returns {string} The display name.
 */
export function displayName(record) {
    if (!record.parent) return record.name;
    const parentName = record.parent.slice(record.parent.lastIndexOf('.') + 1);
    return parentName === record.name ? record.name : `${parentName}.${record.name}`;
}

/**
 * Shortens a one-line text.
 *
 * @param {string} text The text.
 * @param {number} max Maximum length.
 * @returns {string} The text, cut with an ellipsis when longer than `max`.
 */
function shorten(text, max) {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Renders search hits.
 *
 * @param {SearchHit[]} hits The hits, best first.
 * @param {string} query The query, echoed in the heading.
 * @returns {string} A numbered list; each hit ends with the id or guide reference to fetch it.
 */
export function renderSearch(hits, query) {
    if (hits.length === 0) {
        return `No MSDK documentation matches "${query}". Try other words or the name of a class or function. `
            + 'If nothing matches, the MSDK has no public API for it: do not invent one.';
    }
    const lines = [`Results for "${query}" (${hits.length}). Call msdk_get_api with an id, or msdk_get_guide with a guide and section, for the full text.`, ''];
    hits.forEach((hit, i) => {
        if (hit.type === 'api') {
            const r = hit.record;
            const deprecated = r.deprecated !== null ? ' (deprecated)' : '';
            lines.push(`${i + 1}. [${r.kind}] ${displayName(r)}${deprecated}, module ${r.module}`);
            lines.push(`   \`${shorten(r.signature, 200)}\``);
            if (r.summary) lines.push(`   ${shorten(r.summary, 240)}`);
            lines.push(`   id: \`${r.id}\``);
        } else {
            const where = hit.section ? `${hit.guide.title} > ${hit.section.title}` : hit.guide.title;
            lines.push(`${i + 1}. [guide] ${where}`);
            const ref = hit.section ? `guide \`${hit.guide.name}\`, section \`${hit.section.id}\`` : `guide \`${hit.guide.name}\``;
            lines.push(`   ${ref}`);
        }
    });
    return lines.join('\n');
}

/**
 * Renders a link list ("See also", "Throws", inheritors).
 *
 * @param {{label: string, ref?: string, url?: string, doc?: string}[]} links The links.
 * @returns {string[]} One Markdown list line per link.
 */
function renderLinks(links) {
    return links.map((l) => {
        const target = l.ref ? ` (id: \`${l.ref}\`)` : l.url ? ` (${l.url})` : '';
        const doc = l.doc ? `: ${l.doc.replace(/\s*\n\s*/g, ' ')}` : '';
        return `- \`${l.label}\`${target}${doc}`;
    });
}

/**
 * Renders the full documentation of one declaration.
 *
 * @param {Corpus} corpus The corpus (for member lookups and the reference URL).
 * @param {ApiRecord} record The declaration.
 * @param {{withMembers?: boolean}} [options] Whether to list the members of a type (default `true`).
 * @returns {string} The Markdown documentation.
 */
export function renderRecord(corpus, record, { withMembers = true } = {}) {
    const lines = [`# ${displayName(record)} (${record.kind})`, ''];
    const context = [`Module: ${record.module}`, `package \`${record.package}\``];
    if (record.parent) context.push(`member of \`${record.parent}\``);
    lines.push(context.join(', '));
    lines.push(`Id: \`${record.id}\``, '', '```kotlin', record.signature, '```', '');
    if (record.deprecated !== null) lines.push(`**Deprecated.** ${record.deprecated}`, '');
    if (record.doc) lines.push(record.doc, '');
    else lines.push('(No description in the reference.)', '');

    const documentedParams = record.params.filter((p) => p.type || p.doc);
    if (documentedParams.length) {
        lines.push('**Parameters**');
        for (const p of documentedParams) {
            const type = p.type ? `: ${p.type}` : '';
            const def = p.default ? ` = ${p.default}` : '';
            const doc = p.doc ? ` - ${p.doc.replace(/\s*\n\s*/g, ' ')}` : '';
            lines.push(`- \`${p.name}${type}${def}\`${doc}`);
        }
        lines.push('');
    }
    if (record.returns) lines.push(`**Returns:** ${record.returns}`, '');
    if (record.throws.length) lines.push('**Throws**', ...renderLinks(record.throws), '');
    if (record.since) lines.push(`**Since:** ${record.since}`, '');
    if (record.seeAlso.length) lines.push('**See also**', ...renderLinks(record.seeAlso), '');
    if (record.inheritors.length) lines.push('**Known subtypes**', ...renderLinks(record.inheritors), '');

    if (withMembers && TYPE_KINDS.has(record.kind) && record.members.length) {
        lines.push(`**Members** (${record.members.length}; call msdk_get_api with an id for details)`);
        let section = '';
        for (const m of record.members.slice(0, MAX_MEMBERS)) {
            if (m.section !== section) {
                section = m.section;
                lines.push('', `${section}:`);
            }
            const summary = m.summary ? `: ${shorten(m.summary, 160)}` : '';
            const id = m.ref ? ` (id: \`${m.ref}\`)` : '';
            lines.push(`- \`${shorten(m.signature, 200)}\`${summary}${id}`);
        }
        if (record.members.length > MAX_MEMBERS) {
            lines.push(`- ... ${record.members.length - MAX_MEMBERS} more: use msdk_search_docs with module ${record.module} to find them.`);
        }
        lines.push('');
    }
    const url = corpus.docsUrl(record);
    if (url) lines.push(`Reference page: ${url}`);
    return lines.join('\n').trim();
}

/**
 * Renders several declarations that match one name.
 *
 * Overloads (one fully qualified name) are shown in full. Different declarations that share a simple name are
 * listed so that the assistant picks one by id.
 *
 * @param {Corpus} corpus The corpus.
 * @param {ApiRecord[]} records The matches.
 * @param {string} query The name asked for.
 * @returns {string} The Markdown answer.
 */
export function renderMatches(corpus, records, query) {
    const fqns = new Set(records.map((r) => r.fqn));
    if (fqns.size === 1) {
        const head = records.length > 1 ? `${records.length} overloads of \`${records[0].fqn}\`:\n\n` : '';
        return capAnswer(
            head + records.map((r) => renderRecord(corpus, r)).join('\n\n---\n\n'),
            'ask for one overload by its id',
        );
    }
    const lines = [`"${query}" matches ${records.length} declarations. Call msdk_get_api again with one of these ids:`, ''];
    for (const r of records.slice(0, 40)) {
        lines.push(`- [${r.kind}] ${displayName(r)}, module ${r.module}: \`${shorten(r.signature, 160)}\``);
        lines.push(`  id: \`${r.id}\``);
    }
    if (records.length > 40) lines.push(`- ... ${records.length - 40} more: add the type name (\`Type.${query}\`) to narrow.`);
    return lines.join('\n');
}

/**
 * Renders a guide, one of its sections, or its table of contents.
 *
 * @param {Guide} guide The guide.
 * @param {GuideSection|null} section The section asked for, or `null` for the whole guide.
 * @returns {string} The Markdown answer. A long guide asked for as a whole returns its introduction and its table
 *   of contents, so that the assistant asks for the section it needs.
 */
export function renderGuide(guide, section) {
    if (section) {
        const text = guide.text.slice(section.start, section.end).trim();
        return capAnswer(`From the guide "${guide.title}" (guide \`${guide.name}\`):\n\n${text}`, 'ask for a subsection');
    }
    if (guide.text.length <= GUIDE_TOC_THRESHOLD || guide.sections.length === 0) {
        return capAnswer(guide.text, 'ask for one section');
    }
    const introEnd = guide.sections[0].start;
    const lines = [guide.text.slice(0, introEnd).trim(), '', `This guide is long. Call msdk_get_guide with guide \`${guide.name}\` and one of these sections:`, ''];
    for (const s of guide.sections) {
        lines.push(`${s.level === 3 ? '  ' : ''}- ${s.title} (section \`${s.id}\`)`);
    }
    return capAnswer(lines.join('\n'), 'ask for one section');
}

/**
 * Renders the guide list, for errors and for the status answer.
 *
 * @param {Corpus} corpus The corpus.
 * @returns {string[]} One Markdown list line per guide.
 */
export function renderGuideList(corpus) {
    return corpus.guides.map((g) => `- \`${g.name}\`: ${g.title}${g.summary ? `. ${shorten(g.summary, 160)}` : ''}`);
}

/**
 * Looks a section up in a guide, for the tools.
 *
 * @param {Guide} guide The guide.
 * @param {string|undefined} query Section id or title words; empty for the whole guide.
 * @returns {{section: GuideSection|null, missing: boolean}} The section, and whether a section was asked for but
 *   not found.
 */
export function pickSection(guide, query) {
    if (!query || !query.trim()) return { section: null, missing: false };
    const section = findSection(guide, query);
    return { section, missing: section === null };
}
