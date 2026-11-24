/**
 * @file The format of the corpus the server serves: the declarations (`data/api.json`) and the guides
 * (`data/guides.json`). The generator writes these files; the server reads them.
 */

/**
 * A parameter of a function or constructor.
 *
 * @typedef {object} ApiParam
 * @property {string} name Parameter name.
 * @property {string} type Declared type as displayed (for example `List<Int>`, `vararg Int`, `(Boolean) -> Unit`).
 * @property {string} [default] Default value as displayed, when the parameter has one.
 * @property {string} [doc] Documentation of the parameter (Markdown), from the Parameters table.
 */

/**
 * A link out of a declaration ("See also", "Throws", member rows, inheritors), resolved later by the export.
 *
 * @typedef {object} ApiLink
 * @property {string} label The text shown on the page.
 * @property {string} [location] Target page, relative to the Dokka output root, for links inside the reference.
 * @property {string} [url] Target URL, for links outside the reference.
 * @property {string} [doc] Description attached to the link (Markdown), when the page has one.
 */

/**
 * A member listed on a classlike page.
 *
 * @typedef {object} ApiMember
 * @property {string} section Section of the page: Constructors, Types, Properties, Functions or Entries.
 * @property {string} name Member name.
 * @property {string} signature Member signature as displayed.
 * @property {string} summary First sentence of the member documentation.
 * @property {string} [location] Member page, relative to the Dokka output root.
 * @property {string} [ref] Id of the member record, filled in by the export once every page is parsed.
 */

/**
 * One documented declaration: the unit the MCP searches and returns.
 *
 * @typedef {object} ApiRecord
 * @property {string} id Unique id: the fully qualified name, plus the parameter types for functions and constructors.
 * @property {string} fqn Fully qualified name.
 * @property {string} module Gradle module (Dokka module name).
 * @property {string} package Kotlin package.
 * @property {string} name Simple name.
 * @property {string} kind class, interface, object, enum, enum-entry, annotation, typealias, constructor, function,
 *   property or member.
 * @property {string} signature Declaration signature as displayed.
 * @property {string} summary First sentence of the documentation.
 * @property {string} doc Documentation (Markdown), without the sections below.
 * @property {ApiParam[]} params Parameters (functions and constructors).
 * @property {string|null} returns Return value documentation (Markdown).
 * @property {ApiLink[]} throws Documented exceptions.
 * @property {string|null} since Version the declaration appeared in, when documented.
 * @property {string|null} deprecated Deprecation message (Markdown); `null` when not deprecated.
 * @property {string|null} parent Fully qualified name of the enclosing declaration; `null` at package level.
 * @property {ApiMember[]} members Members (classlike pages only).
 * @property {ApiLink[]} inheritors Known subtypes (classlike pages only).
 * @property {ApiLink[]} seeAlso "See also" links.
 * @property {string} location Page of the declaration, relative to the Dokka output root.
 */

/**
 * One section of a guide.
 *
 * @typedef {object} GuideSection
 * @property {string} id Slug of the heading, unique in the guide (for example `core-initialization`).
 * @property {string} title Heading text.
 * @property {number} level Heading level (2 or 3).
 * @property {number} start Offset of the heading line in the guide text.
 * @property {number} end Offset where the section ends (next heading of the same or a higher level).
 * @property {number} ownEnd Offset where the section's own text ends (next heading of any level).
 */

/**
 * A guide: a module page or a curated document.
 *
 * @typedef {object} Guide
 * @property {string} name Guide name used by the tools (a module name such as `Core`, `overview`, or the file name
 *   of a curated guide).
 * @property {string} title Display title.
 * @property {string|null} module Module the guide documents, or `null`.
 * @property {string} summary First sentence of the introduction.
 * @property {string} text Full Markdown text, title included.
 * @property {GuideSection[]} sections Sections in document order.
 */

export {};
