'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Path to the unifi2snipe binary
const BINARY = process.env.UNIFI2SNIPE_BINARY || 'unifi2snipe';

// Working directory for unifi2snipe commands
const WORKDIR = process.env.UNIFI2SNIPE_CWD ||
  path.join(process.env.HOME || '/root', '.openclaw', 'workspace', 'unifi2snipe');

/**
 * Run unifi2snipe with the given subcommand and flags.
 * @param {string[]} args - subcommand and flags, e.g. ['setup', '-v', '--dry-run']
 * @returns {{ stdout: string, stderr: string }}
 */
function runUnifi(args) {
  const fullCmd = `${BINARY} ${args.join(' ')}`;
  try {
    const result = execSync(fullCmd, {
      cwd: WORKDIR,
      env: { ...process.env },
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.toString('utf8'), stderr: '' };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString('utf8') : '';
    const stdout = err.stdout ? err.stdout.toString('utf8') : '';
    if (stderr) return { stdout, stderr };
    if (stdout) return { stdout, stderr: stdout };
    return { stdout: '', stderr: err.message };
  }
}

/** Parse numeric IDs from settings.yaml */
function parseConfigIds() {
  try {
    const yaml = require('fs').readFileSync(
      path.join(WORKDIR, 'settings.yaml'), 'utf8'
    );
    const ids = {};
    const patterns = [
      [/^\s*manufacturer_id:\s*(\d+)/m, 'manufacturerId'],
      [/^\s*network_category_id:\s*(\d+)/m, 'networkCategoryId'],
      [/^\s*console_category_id:\s*(\d+)/m, 'consoleCategoryId'],
      [/^\s*custom_fieldset_id:\s*(\d+)/m, 'customFieldsetId'],
    ];
    for (const [re, key] of patterns) {
      const m = yaml.match(re);
      if (m) ids[key] = parseInt(m[1], 10);
    }
    return ids;
  } catch (_) {
    return {};
  }
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: 'unifi2snipe_setup',
    description:
      'Run `unifi2snipe setup` to create Snipe-IT manufacturer, categories, ' +
      'fieldset, and custom fields. Run this once before any sync.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Enable verbose output (INFO level)',
        },
        debug: {
          type: 'boolean',
          description: 'Enable debug output (DEBUG level)',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Simulate without making changes',
        },
        config: {
          type: 'string',
          description: 'Path to settings.yaml (default: settings.yaml)',
        },
      },
    },
  },
  {
    name: 'unifi2snipe_sync',
    description:
      'Run `unifi2snipe sync` to download UniFi device data and create/update ' +
      'Snipe-IT assets. Run `unifi2snipe setup` first if not already done.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Enable verbose output',
        },
        debug: {
          type: 'boolean',
          description: 'Enable debug output',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Simulate without making changes',
        },
        force: {
          type: 'boolean',
          description: 'Force full re-sync, ignoring cached data',
        },
        'update-only': {
          type: 'boolean',
          description: 'Only update existing assets, never create new ones',
        },
        'cache-dir': {
          type: 'string',
          description: 'Directory for cached API responses',
        },
      },
    },
  },
  {
    name: 'unifi2snipe_download',
    description:
      'Run `unifi2snipe download` to fetch UniFi device data into local cache ' +
      'without syncing to Snipe-IT. Useful for previewing data before a sync.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: {
          type: 'boolean',
          description: 'Enable verbose output',
        },
        debug: {
          type: 'boolean',
          description: 'Enable debug output',
        },
        'cache-dir': {
          type: 'string',
          description: 'Directory for cached API responses',
        },
      },
    },
  },
  {
    name: 'unifi2snipe_status',
    description:
      'Show current configuration state: parsed Snipe-IT resource IDs from ' +
      'settings.yaml, and MCP server cache info.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'unifi2snipe_read_config',
    description: 'Read and return the raw settings.yaml content.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// --- MCP Server ---

const server = new Server(
  { name: 'unifi2snipe', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const { name, arguments: args = {} } = params;

  /** Build flag array from args object */
  const flags = (argObj) => {
    const f = [];
    for (const [k, v] of Object.entries(argObj)) {
      if (v === true) f.push(`--${k}`);
      else if (typeof v === 'string' && v) f.push(`--${k}`, v);
    }
    return f;
  };

  try {
    switch (name) {
      case 'unifi2snipe_setup': {
        const { stdout, stderr } = runUnifi(['setup', ...flags(args)]);
        const out = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
        return {
          content: [{ type: 'text', text: out || '(no output)' }],
          isError: Boolean(stderr && stderr.includes('Error')),
        };
      }

      case 'unifi2snipe_sync': {
        const { stdout, stderr } = runUnifi(['sync', ...flags(args)]);
        const out = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
        return {
          content: [{ type: 'text', text: out || '(no output)' }],
          isError: Boolean(stderr && stderr.includes('Error')),
        };
      }

      case 'unifi2snipe_download': {
        const { stdout, stderr } = runUnifi(['download', ...flags(args)]);
        const out = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '');
        return {
          content: [{ type: 'text', text: out || '(no output)' }],
          isError: Boolean(stderr && stderr.includes('Error')),
        };
      }

      case 'unifi2snipe_status': {
        const ids = parseConfigIds();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ settings: ids }, null, 2),
          }],
        };
      }

      case 'unifi2snipe_read_config': {
        const content = require('fs').readFileSync(
          path.join(WORKDIR, 'settings.yaml'), 'utf8'
        );
        return { content: [{ type: 'text', text: content }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// --- Start ---
(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
