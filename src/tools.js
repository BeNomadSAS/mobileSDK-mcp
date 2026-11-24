/**
 * @file The MCP tools: their definitions and their handlers, independent of the MCP SDK.
 *
 * Each tool is plain data (name, title, description, input fields) plus a handler that turns arguments into a
 * text answer. `transport.js` registers them with the SDK; the unit tests call the handlers directly, so the
 * tools can be tested without the SDK.
 *
 * Tools: `msdk_status`, `msdk_get_started`, `msdk_search_docs` and `msdk_get_api`, plus `msdk_get_guide` to read
 * a guide section that a search found.
 *
 * Every tool is read-only, deterministic and offline.
 */

import { SEARCH_KINDS } from './corpus.js';
import { capAnswer, pickSection, renderGuide, renderGuideList, renderMatches, renderRecord, renderSearch } from './render.js';

/** @typedef {import('./corpus.js').Corpus} Corpus */

/**
 * The text a handler returns.
 *
 * @typedef {object} ToolAnswer
 * @property {string} text Markdown answer.
 * @property {boolean} [isError] `true` when the request could not be answered (unknown name, bad section...).
 */

/**
 * An input field of a tool. The adapter turns these into the SDK's schema objects.
 *
 * @typedef {object} ToolField
 * @property {'string'|'integer'|'boolean'} type Field type.
 * @property {string} description What the field means, for the assistant.
 * @property {boolean} [required] Whether the field is mandatory.
 * @property {number} [minLength] Minimum string length.
 * @property {number} [maxLength] Maximum string length.
 * @property {number} [minimum] Minimum integer.
 * @property {number} [maximum] Maximum integer.
 * @property {string[]} [enum] Allowed values (strings).
 * @property {string|number|boolean} [default] Value used when the caller omits the field; published in the schema.
 */

/**
 * A tool definition.
 *
 * @typedef {object} ToolDefinition
 * @property {string} name Tool name.
 * @property {string} title Human-readable title.
 * @property {string} description What the tool does and when to call it, for the assistant.
 * @property {Record<string, ToolField>} input Input fields; empty for a tool without arguments.
 * @property {(corpus: Corpus, args: Record<string, any>) => ToolAnswer} handler The handler.
 */

/** Default and maximum number of search hits. */
export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 20;

/**
 * Builds the rules an assistant must follow, for the server instructions and the status answer.
 *
 * Clients may skip the instructions (`server/discover` is optional in the 2026-07-28 revision), so the rules are
 * also returned by `msdk_status` and summed up in the tool descriptions.
 *
 * @param {Corpus} corpus The corpus (for the version).
 * @returns {string} The rules, as a numbered Markdown list.
 */
export function buildRules(corpus) {
    const { version } = corpus.meta;
    return [
        `1. Check the version first. This server documents MSDK ${version}. Compare it with the \`msdk_version\` that the `
            + 'app uses for its `com.benomad.sdk:*` dependencies. If they differ, say so: this documentation may not match '
            + "the app's MSDK.",
        '2. Write all code that uses the MSDK in Kotlin.',
        '3. In MSDK signatures, `Error` is `com.benomad.msdk.errormanager.Error`, not `kotlin.Error`; import it explicitly.',
        '4. For setup, initialisation order and lifecycle, start with msdk_get_started and the module guides '
            + '(msdk_get_guide), then check each declaration with msdk_get_api.',
        '5. Use only declarations that msdk_get_api returns. When msdk_search_docs finds nothing, say that the MSDK has no '
            + 'such public API; never invent one.',
    ].join('\n');
}

/**
 * Builds the server instructions sent to clients that read them.
 *
 * @param {Corpus} corpus The corpus.
 * @returns {string} The instructions.
 */
export function buildInstructions(corpus) {
    const { product, version, buildType } = corpus.meta;
    return `This server answers questions about the ${product}, version ${version} (${buildType}), from its published `
        + 'API reference and module guides. It works offline and is read-only.\n\n'
        + `Rules:\n${buildRules(corpus)}`;
}

/** Reminder appended to the descriptions of the tools that return API content. */
const DESCRIPTION_RULES = 'Write MSDK code in Kotlin; `Error` in signatures is com.benomad.msdk.errormanager.Error.';

/**
 * Builds the tool definitions for a corpus.
 *
 * @param {Corpus} corpus The corpus (module names feed the `module` field).
 * @returns {ToolDefinition[]} The tools, in the order they are listed to clients.
 */
export function buildTools(corpus) {
    const modules = corpus.moduleNames();
    return [
        {
            name: 'msdk_status',
            title: 'MSDK documentation status',
            description: 'Returns the version of the BeNomad MSDK for Android that this server documents, its build type, '
                + 'modules and guides, and the rules for using the answers. Call it first and compare the version with the '
                + "app's msdk_version (its com.benomad.sdk dependencies).",
            input: {},
            handler: (c) => ({ text: statusText(c) }),
        },
        {
            name: 'msdk_get_started',
            title: 'Getting started with the MSDK',
            description: 'Returns how to start with the MSDK: integration (Maven repository and dependencies), the modules, '
                + 'and the initialisation order. Call it before writing setup or initialisation code. '
                + DESCRIPTION_RULES,
            input: {},
            handler: (c) => ({ text: getStartedText(c) }),
        },
        {
            name: 'msdk_search_docs',
            title: 'Search the MSDK documentation',
            description: 'Searches the MSDK API reference and module guides with words, a declaration name or a question. '
                + 'Returns ranked hits with an id; then call msdk_get_api with an id, or msdk_get_guide with a guide and '
                + 'section. ' + DESCRIPTION_RULES,
            input: {
                query: { type: 'string', description: 'Words, a class or function name, or a question.', required: true, minLength: 1, maxLength: 300 },
                module: { type: 'string', description: 'Only search this module.', enum: modules },
                kind: { type: 'string', description: 'Only return this kind of result: "type" for any class-like declaration, "guide" for guide sections.', enum: SEARCH_KINDS },
                limit: { type: 'integer', description: 'Maximum number of hits.', minimum: 1, maximum: MAX_SEARCH_LIMIT, default: DEFAULT_SEARCH_LIMIT },
            },
            handler: searchHandler,
        },
        {
            name: 'msdk_get_api',
            title: 'Get an MSDK declaration',
            description: 'Returns the exact signature and documentation of an MSDK declaration (class, interface, object, '
                + 'enum, function, property, constructor): parameters, return value, exceptions, deprecation, and the '
                + 'members of a type. Accepts an id from msdk_search_docs, a fully qualified name, Type.member or a '
                + 'simple name; an ambiguous name lists the matches. ' + DESCRIPTION_RULES,
            input: {
                symbol: { type: 'string', description: 'An id from msdk_search_docs, a fully qualified name, Type.member, or a simple name.', required: true, minLength: 1, maxLength: 400 },
                members: { type: 'boolean', description: 'For a type, list its members.', default: true },
            },
            handler: getApiHandler,
        },
        {
            name: 'msdk_get_guide',
            title: 'Read an MSDK guide',
            description: 'Returns an MSDK guide in Markdown, or one of its sections: "overview" (modules and integration), '
                + 'a module page (for example "Core" or "Mapping"), or a curated guide. Long guides return their table of '
                + 'contents first; ask again with a section id or title. ' + DESCRIPTION_RULES,
            input: {
                guide: { type: 'string', description: 'Guide name: "overview", a module name, or a guide listed by msdk_status.', required: true, minLength: 1, maxLength: 100 },
                section: { type: 'string', description: 'Section id or title words; omit for the whole guide or its table of contents.', maxLength: 200 },
            },
            handler: getGuideHandler,
        },
    ];
}

/**
 * Builds the status answer.
 *
 * @param {Corpus} corpus The corpus.
 * @returns {string} Version, build type, modules, guides and rules.
 */
export function statusText(corpus) {
    const { product, version, buildType, modules, counts } = corpus.meta;
    const lines = [
        `# ${product} ${version}`,
        '',
        `Build type: ${buildType}${buildType === 'release' ? '' : ' (not a release: the API may still change)'}.`,
        `Documented declarations: ${counts.declarations}. Guides: ${counts.guides}.`,
        '',
        '## Modules',
        ...modules.map((m) => `- ${m.name} (${m.declarations} declarations)${m.summary ? `: ${m.summary}` : ''}`),
        '',
        '## Guides (msdk_get_guide)',
        ...renderGuideList(corpus),
        '',
        '## Rules',
        buildRules(corpus),
    ];
    return lines.join('\n');
}

/**
 * Builds the getting-started answer.
 *
 * A curated `get-started` guide is returned as is when the corpus has one. Otherwise the answer is assembled from the
 * overview's integration section, the module list and the Core initialisation section.
 *
 * @param {Corpus} corpus The corpus.
 * @returns {string} The Markdown answer.
 */
export function getStartedText(corpus) {
    const curated = corpus.guide('get-started');
    if (curated) return capAnswer(curated.text, 'ask msdk_get_guide for one section of guide "get-started"');

    const parts = [`# Getting started with the ${corpus.meta.product} ${corpus.meta.version}`, ''];
    const overview = corpus.guide('overview');
    const integration = overview ? pickSection(overview, 'integration').section : null;
    if (integration) {
        parts.push(overview.text.slice(integration.start, integration.end).trim(), '');
    }
    parts.push('## Modules in this documentation', ...corpus.meta.modules.map((m) => `- ${m.name}${m.summary ? `: ${m.summary}` : ''}`), '');
    const core = corpus.guide('Core');
    const init = core ? pickSection(core, 'initialization').section ?? pickSection(core, 'initialisation').section : null;
    if (init) {
        parts.push(core.text.slice(init.start, init.end).trim(), '');
    }
    parts.push('## Next steps', '- Read the page of each module you use with msdk_get_guide (for example guide "Mapping").');
    parts.push('- Check every class and function with msdk_get_api before using it.', '', '## Rules', buildRules(corpus));
    return capAnswer(parts.join('\n'), 'ask msdk_get_guide for guide "overview" or "Core", one section at a time');
}

/**
 * Handles `msdk_search_docs`.
 *
 * @param {Corpus} corpus The corpus.
 * @param {{query: string, module?: string, kind?: string, limit?: number}} args The arguments.
 * @returns {ToolAnswer} The ranked hits.
 */
export function searchHandler(corpus, args) {
    const query = String(args.query ?? '').trim();
    if (!query) return { text: 'The query is empty.', isError: true };
    const limit = Math.min(Math.max(Number(args.limit ?? DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const hits = corpus.search(query, { module: args.module, kind: args.kind, limit });
    return { text: capAnswer(renderSearch(hits, query), 'lower the limit or add a module filter') };
}

/**
 * Handles `msdk_get_api`.
 *
 * @param {Corpus} corpus The corpus.
 * @param {{symbol: string, members?: boolean}} args The arguments.
 * @returns {ToolAnswer} The declaration, its overloads, or the list of matches for an ambiguous name.
 */
export function getApiHandler(corpus, args) {
    const symbol = String(args.symbol ?? '').trim();
    if (!symbol) return { text: 'The symbol is empty.', isError: true };
    const matches = corpus.resolve(symbol);
    if (matches.length === 0) {
        const hits = corpus.search(symbol, { limit: 5 }).filter((h) => h.type === 'api');
        const suggestions = hits.map((h) => `- \`${h.record.id}\``).join('\n');
        return {
            text: `No MSDK declaration is named "${symbol}".${suggestions ? ` Closest declarations:\n${suggestions}` : ''}\n`
                + 'Do not use a declaration that msdk_get_api does not return.',
            isError: true,
        };
    }
    if (matches.length === 1 && args.members === false) {
        return { text: capAnswer(renderRecord(corpus, matches[0], { withMembers: false }), 'ask for one member by id') };
    }
    return { text: capAnswer(renderMatches(corpus, matches, symbol), 'ask for one declaration by id') };
}

/**
 * Handles `msdk_get_guide`.
 *
 * @param {Corpus} corpus The corpus.
 * @param {{guide: string, section?: string}} args The arguments.
 * @returns {ToolAnswer} The guide, its table of contents, or one section.
 */
export function getGuideHandler(corpus, args) {
    const name = String(args.guide ?? '').trim();
    const guide = name ? corpus.guide(name) : null;
    if (!guide) {
        return { text: `No guide is named "${name}". Available guides:\n${renderGuideList(corpus).join('\n')}`, isError: true };
    }
    const { section, missing } = pickSection(guide, args.section);
    if (missing) {
        const toc = guide.sections.map((s) => `- ${s.title} (section \`${s.id}\`)`).join('\n');
        return { text: `The guide "${guide.title}" has no section "${args.section}". Its sections:\n${toc}`, isError: true };
    }
    return { text: renderGuide(guide, section) };
}
