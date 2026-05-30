import express from "express";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "path";
import { createServer as createViteServer } from "vite";

const MAX_PROXY_BYTES = 10 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
const MAX_PROXY_REDIRECTS = 3;

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function assertPublicHttpUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) image URLs are allowed");
  }

  const host = url.hostname;
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("URL host could not be resolved");
  }

  for (const { address } of addresses) {
    const version = isIP(address);
    if (version === 4 && isPrivateIPv4(address)) {
      throw new Error("Private network URLs are not allowed");
    }
    if (version === 6 && isPrivateIPv6(address)) {
      throw new Error("Private network URLs are not allowed");
    }
  }

  return url;
}

async function fetchAllowedImage(rawUrl: string) {
  let url = await assertPublicHttpUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_PROXY_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_PROXY_REDIRECTS) {
          throw new Error("Too many redirects");
        }
        url = await assertPublicHttpUrl(new URL(location, url).toString());
        continue;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Too many redirects");
}

async function readLimitedBody(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_PROXY_BYTES) {
    throw new Error("Image is too large");
  }

  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_PROXY_BYTES) {
      throw new Error("Image is too large");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, total);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // API proxy route first
  app.get("/api/proxy", async (req, res) => {
    const imageUrl = req.query.url;
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      return res.status(400).send("No URL provided");
    }

    try {
      const response = await fetchAllowedImage(imageUrl.trim());
      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType?.toLowerCase().startsWith("image/")) {
        return res.status(415).send("Only image responses can be proxied");
      }

      const imageBuffer = await readLimitedBody(response);

      if (contentType) {
        res.setHeader("Content-Type", contentType);
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day

      res.send(imageBuffer);
    } catch (err) {
      console.error("Proxy error for URL", imageUrl, err);
      res.status(400).send(err instanceof Error ? err.message : "Failed to proxy image");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
