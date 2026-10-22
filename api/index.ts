let cachedApp: any = null;

export default async function handler(req: any, res: any) {
  try {
    if (!cachedApp) {
      console.log("[Vercel API] Starting server instance...");
      let startServerFn: any = null;
      const importErrors: string[] = [];

      // Try importing with .js extension (standard for ES Modules in Node)
      try {
        const mod = await import("../server.js");
        startServerFn = mod.startServer;
        console.log("[Vercel API] Successfully imported '../server.js'");
      } catch (err: any) {
        importErrors.push(`../server.js: ${err.message || err}`);
      }

      // Try importing with no extension
      if (!startServerFn) {
        try {
          const mod = await import("../server");
          startServerFn = mod.startServer;
          console.log("[Vercel API] Successfully imported '../server' (no extension)");
        } catch (err: any) {
          importErrors.push(`../server (no extension): ${err.message || err}`);
        }
      }

      // Try importing with .ts extension as a last resort
      if (!startServerFn) {
        try {
          const mod = await import("../server.ts" as any);
          startServerFn = mod.startServer;
          console.log("[Vercel API] Successfully imported '../server.ts'");
        } catch (err: any) {
          importErrors.push(`../server.ts: ${err.message || err}`);
        }
      }

      if (!startServerFn) {
        throw new Error(`Could not resolve server module. Errors: ${importErrors.join(" | ")}`);
      }

      cachedApp = await startServerFn();
    }
    return cachedApp(req, res);
  } catch (err: any) {
    console.error("[Vercel API Critical Error]", err);
    res.status(500).json({
      error: "Critical Server Initialization Error",
      message: err.message || String(err),
      stack: err.stack || null
    });
  }
}


