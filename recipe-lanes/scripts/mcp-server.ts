/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium, Browser, Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage() {
    if (!browser) {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
    }
    return page!;
}

const server = new Server(
  {
    name: "recipe-lanes-dev-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "inspect_page",
        description: "Get the HTML content of the local dev instance page.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to inspect (e.g. '/lanes')" },
          },
        },
      },
      {
        name: "take_screenshot",
        description: "Take a screenshot of the local dev instance.",
        inputSchema: {
          type: "object",
          properties: {
             path: { type: "string", description: "Path to screenshot" },
          }
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const p = await getPage();
  const baseUrl = "http://localhost:8001"; 

  if (request.params.name === "inspect_page") {
    const path = String(request.params.arguments?.path || "/");
    await p.goto(`${baseUrl}${path}`);
    await p.waitForLoadState('networkidle');
    const content = await p.content();
    return {
      content: [{ type: "text", text: content }],
    };
  }

  if (request.params.name === "take_screenshot") {
      const path = String(request.params.arguments?.path || "/");
      await p.goto(`${baseUrl}${path}`);
      await p.waitForLoadState('networkidle');
      const buffer = await p.screenshot();
      return {
          content: [{ type: "image/png", data: buffer.toString('base64'), mimeType: "image/png" }]
      };
  }

  throw new Error("Tool not found");
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Recipe Lanes MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});