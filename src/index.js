#!/usr/bin/env node
/**
 * @file Entry point of the MSDK MCP server (`msdk-mcp`).
 *
 * ```
 * msdk-mcp            serve over stdio: the assistant starts this program and talks to it on stdin/stdout
 * msdk-mcp --version  print the MSDK version this package documents
 * msdk-mcp --help     print the usage
 * ```
 *
 * The documentation is read from the `data/` folder next to the `src/` folder of this file, in the repository, the
 * npm package and the `.mcpb` bundle alike. `--data <dir>` overrides it (development and tests).
 *
 * The first line lets npm install this file as the `msdk-mcp` command; `node src/index.js` runs it the same way.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Corpus } from './corpus.js';
import { createServerFactory, serveOverStdio } from './transport.js';

const HELP = `Usage: msdk-mcp [--version] [--help]

Serves the BeNomad MSDK for Android documentation to AI assistants over the Model Context Protocol, on stdio:
the assistant starts this program. Register it in your assistant as INSTALL.md shows.

  --version       print the MSDK version documented by this package
  --help          print this help
`;

/**
 * Parses the command line.
 *
 * @param {string[]} argv Arguments after the program name.
 * @returns {{data: string, version: boolean, help: boolean}} The documentation folder, and whether to print the
 *   version or the help instead of serving.
 * @throws {Error} On an unknown option.
 */
export function parseCommandLine(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            data: { type: 'string' },
            version: { type: 'boolean', short: 'v', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
        strict: true,
    });
    const here = dirname(fileURLToPath(import.meta.url));
    return {
        data: values.data ? resolve(values.data) : join(here, '..', 'data'),
        version: values.version,
        help: values.help,
    };
}

/**
 * Starts the server.
 */
function main() {
    let options;
    try {
        options = parseCommandLine(process.argv.slice(2));
    } catch (error) {
        console.error(`${error.message}\n\n${HELP}`);
        process.exit(2);
    }
    if (options.help) {
        process.stdout.write(HELP);
        return;
    }
    if (!existsSync(join(options.data, 'meta.json'))) {
        console.error(`No documentation data at ${options.data}. The package is incomplete: reinstall it.`);
        process.exit(1);
    }
    const corpus = Corpus.load(options.data);
    if (options.version) {
        process.stdout.write(`${corpus.meta.product} ${corpus.meta.version} (${corpus.meta.buildType})\n`);
        return;
    }
    serveOverStdio(createServerFactory(corpus));
    // stderr only: stdout carries the protocol.
    console.error(`msdk-mcp ${corpus.meta.version}: serving over stdio`);
}

try {
    main();
} catch (error) {
    console.error(`msdk-mcp failed to start: ${error.message}`);
    process.exit(1);
}
