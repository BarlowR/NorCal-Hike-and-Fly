/**
 * Cloudflare Worker — igc Upload Endpoint
 *
 * Accepts igc file uploads and stores them in R2 under:
 *   incoming/<user_id>/<timestamp>-<filename>.igc
 *
 * Deploy with: npx wrangler deploy
 *
 * wrangler.toml binds this worker to your R2 bucket:
 *
 *   [[r2_buckets]]
 *   binding = "TRACKLOGS"
 *   bucket_name = "tracklogs"
 */

export default {
  async fetch(request, env) {
    
    // Rate limiting
    const ip = request.headers.get("CF-Connecting-IP");
    const key = `rate:${ip}`;
    const count = parseInt(await env.RATE_KV.get(key) || "0");

    if (count >= 10) {
    return jsonResponse({ error: "Too many uploads, try again later" }, 429);
    }

    await env.RATE_KV.put(key, String(count + 1), { expirationTtl: 60 });

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POST required" }, 405);
    }

    try {
      const url = new URL(request.url);

      // Expect POST /upload?user_id=alice
      if (url.pathname !== "/upload") {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const userId = url.searchParams.get("user_id");
      if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) {
        return jsonResponse({ error: "Invalid or missing user_id" }, 400);
      }

      const passphrase = url.searchParams.get("passphrase");
      if (!passphrase) {
        return jsonResponse({ error: "Missing passphrase" }, 400);
      }

      // Authenticate against users.json in R2
      const usersObj = await env.TRACKLOGS.get("users.json");
      if (!usersObj) {
        console.error("users.json not found in R2");
        return jsonResponse({ error: "Internal server error" }, 500);
      }
      const users = await usersObj.json();
      if (!users[userId] || users[userId] !== passphrase) {
        return jsonResponse({ error: "Invalid username or passphrase" }, 401);
      }

      // Read the uploaded file
      const contentType = request.headers.get("Content-Type") || "";
      let fileData, fileName;

      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) return jsonResponse({ error: "No file in form data" }, 400);
        fileName = file.name || "track.igc";
        fileData = await file.arrayBuffer();
      } else {
        // Raw body upload
        fileName = url.searchParams.get("filename") || "track.igc";
        fileData = await request.arrayBuffer();
      }

      // Basic validation
      if (!fileName.toLowerCase().endsWith(".igc")) {
        return jsonResponse({ error: "Only .igc files are accepted" }, 400);
      }
      if (fileData.byteLength > 10 * 1024 * 1024) {
        return jsonResponse({ error: "File too large (10MB max)" }, 400);
      }
      if (fileData.byteLength === 0) {
        return jsonResponse({ error: "Empty file" }, 400);
      }

      // Store in R2: incoming/<user_id>/<timestamp>-<filename>.igc
      const timestamp = Date.now();
      const key = `incoming/${userId}/${timestamp}-${fileName}`;

      await env.TRACKLOGS.put(key, fileData, {
        customMetadata: {
          user_id: userId,
          uploaded_at: new Date().toISOString(),
          original_filename: fileName,
        },
      });

      return jsonResponse({
        success: true,
        key,
        message: "Tracklog uploaded. It will be processed in the next daily build.",
      }, 200);

    } catch (err) {
      console.error("Upload error:", err);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}