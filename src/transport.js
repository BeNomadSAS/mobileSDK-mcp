/**
 * @file The only module that depends on the MCP SDK: it turns the tool definitions into an `McpServer` and serves
 * it over stdio.
 *
 * SDK: `@modelcontextprotocol/server` 2.x (the TypeScript SDK v2). `serveStdio(factory)` pins one server instance per
 * connection and serves the 2026-07-28 protocol revision and, for older clients, the 2025 revisions: the client's
 * first message picks the revision.
 *
 * Keeping the SDK calls here means an SDK upgrade touches one file, and the tools stay testable without the SDK.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { buildInstructions, buildTools } from './tools.js';

/** @typedef {import('./corpus.js').Corpus} Corpus */
/** @typedef {import('./tools.js').ToolField} ToolField */
/** @typedef {import('./tools.js').ToolDefinition} ToolDefinition */

/** Server name announced to clients. */
export const SERVER_NAME = 'benomad-msdk';

/** Behaviour hints shared by every tool: read-only, no side effect, no network. */
const TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/**
 * Turns the input fields of a tool into a zod object schema, which the SDK validates calls against and advertises
 * as JSON Schema in `tools/list`.
 *
 * @param {Record<string, ToolField>} input The tool's input fields.
 * @returns {import('zod/v4').ZodObject} The schema.
 */
export function toZodSchema(input) {
    /** @type {Record<string, import('zod/v4').ZodType>} */
    const shape = {};
    for (const [name, field] of Object.entries(input)) {
        let schema;
        if (field.type === 'string') {
            if (field.enum) {
                schema = z.enum(/** @type {[string, ...string[]]} */ (field.enum));
            } else {
                schema = z.string();
                if (field.minLength !== undefined) schema = schema.min(field.minLength);
                if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
            }
        } else if (field.type === 'integer') {
            schema = z.number().int();
            if (field.minimum !== undefined) schema = schema.min(field.minimum);
            if (field.maximum !== undefined) schema = schema.max(field.maximum);
        } else if (field.type === 'boolean') {
            schema = z.boolean();
        } else {
            throw new Error(`Unsupported field type ${field.type} for ${name}`);
        }
        // A field with a default is optional for the caller and published with its "default", so that clients
        // pre-fill it (a form shows the box of a default-true boolean checked) and assistants know the value used.
        if (field.default !== undefined) schema = schema.default(field.default);
        schema = schema.describe(field.description);
        shape[name] = field.required || field.default !== undefined ? schema : schema.optional();
    }
    return z.object(shape);
}

/**
 * Wraps a schema so that the JSON Schema it publishes in `tools/list` carries no `$schema` dialect marker.
 *
 * Zod publishes `"$schema": "https://json-schema.org/draft/2020-12/schema"`. The keywords the tools use (type,
 * properties, required, enum, minLength, maxLength, minimum, maximum, description) mean the same in every dialect,
 * but some clients reject the marker itself: validators that only know draft-07, and assistants whose tool
 * declarations accept a fixed set of schema keys. Without the marker, each client reads the schema in its default
 * dialect. Validation is unchanged: incoming arguments are still checked by the zod schema.
 *
 * The wrapper implements the Standard Schema interfaces that `registerTool` accepts (`~standard.validate` and
 * `~standard.jsonSchema`), delegating both to the zod schema.
 *
 * @param {import('zod/v4').ZodType} schema The zod schema.
 * @returns {object} A Standard Schema with JSON Schema conversion.
 */
export function withoutDialectMarker(schema) {
    const std = schema['~standard'];
    /** @param {Record<string, unknown>} json A converted schema. */
    const strip = (json) => {
        const { $schema, ...rest } = json;
        return rest;
    };
    return {
        '~standard': {
            version: std.version,
            vendor: std.vendor,
            types: std.types,
            validate: (value, options) => std.validate(value, options),
            jsonSchema: {
                input: (options) => strip(std.jsonSchema.input(options)),
                output: (options) => strip(std.jsonSchema.output(options)),
            },
        },
    };
}

/**
 * Wraps a tool handler into the SDK callback shape.
 *
 * A handler error becomes an `isError` result with a short message: the assistant sees what went wrong, and no
 * stack trace or file path leaves the server.
 *
 * @param {Corpus} corpus The corpus.
 * @param {ToolDefinition} tool The tool.
 * @returns {(...cbArgs: any[]) => Promise<{content: {type: 'text', text: string}[], isError?: boolean}>} The callback.
 */
function toCallback(corpus, tool) {
    const hasInput = Object.keys(tool.input).length > 0;
    return async (...cbArgs) => {
        // With an input schema the SDK calls (args, ctx); without one it calls (ctx).
        const args = hasInput ? (cbArgs[0] ?? {}) : {};
        try {
            const answer = tool.handler(corpus, args);
            return { content: [{ type: 'text', text: answer.text }], ...(answer.isError ? { isError: true } : {}) };
        } catch (error) {
            return { content: [{ type: 'text', text: `The ${tool.name} tool failed: ${error.message}` }], isError: true };
        }
    };
}

/**
 * Creates the server factory: each call builds an `McpServer` with every tool registered.
 *
 * The SDK calls the factory for each connection, so it must be cheap: it only registers the tools; the corpus is
 * shared.
 *
 * @param {Corpus} corpus The loaded corpus.
 * @returns {() => McpServer} The factory.
 */
export function createServerFactory(corpus) {
    const tools = buildTools(corpus);
    const instructions = buildInstructions(corpus);
    const serverInfo = {
        name: SERVER_NAME,
        version: corpus.meta.version,
        title: `${corpus.meta.product} documentation`,
        description: `Offline API reference and guides of the ${corpus.meta.product} ${corpus.meta.version}.`,
    };
    return () => {
        const server = new McpServer(serverInfo, { capabilities: { tools: {} }, instructions });
        for (const tool of tools) {
            /** @type {Record<string, any>} */
            const config = { title: tool.title, description: tool.description, annotations: { title: tool.title, ...TOOL_ANNOTATIONS } };
            if (Object.keys(tool.input).length > 0) config.inputSchema = withoutDialectMarker(toZodSchema(tool.input));
            server.registerTool(tool.name, config, toCallback(corpus, tool));
        }
        return server;
    };
}

/**
 * Serves over stdio until the client closes the connection or the process is stopped.
 *
 * stdout carries the protocol: nothing else may be written to it. Logs go to stderr.
 *
 * @param {() => McpServer} factory The server factory.
 */
export function serveOverStdio(factory) {
    const handle = serveStdio(factory, { onerror: (error) => console.error(`[msdk-mcp] ${error.message}`) });
    const stop = () => {
        handle.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
