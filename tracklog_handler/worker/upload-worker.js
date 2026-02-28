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
      const userRecord = users[userId];
      if (!userRecord || userRecord.passphrase !== passphrase) {
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

      // Contest window: March 1–31 only
      const now = new Date();
      if (now.getMonth() !== 2) {
        return jsonResponse({ error: "Uploads are only accepted during the contest window (March 1–31)" }, 403);
      }

      // Basic validation
      const ext = fileName.split('.').pop()?.toLowerCase();
      if (ext !== "igc" && ext !== "gpx") {
        return jsonResponse({ error: "Only .igc and .gpx files are accepted" }, 400);
      }
      if (fileData.byteLength > 10 * 1024 * 1024) {
        return jsonResponse({ error: "File too large (10MB max)" }, 400);
      }
      if (fileData.byteLength === 0) {
        return jsonResponse({ error: "Empty file" }, 400);
      }

      // Validate tracklog date is within March
      const text = new TextDecoder().decode(fileData);
      const flightDate = extractFlightDate(text);
      if (!flightDate) {
        return jsonResponse({ error: "Could not determine flight date from tracklog" }, 400);
      }
      if (flightDate.getMonth() !== 2) {
        return jsonResponse({ error: "Tracklog date must be within the contest window (March 1–31)" }, 403);
      }

      // Hash file content for dedup (per-user only)
      const hashBuffer = await crypto.subtle.digest("SHA-256", fileData);
      const fileHash = [...new Uint8Array(hashBuffer)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Check for duplicate across incoming/ and processed/ for this user
      for (const prefix of [`incoming/${userId}/`, `processed/${userId}/`]) {
        const existing = await env.TRACKLOGS.list({ prefix });
        for (const obj of existing.objects) {
          const head = await env.TRACKLOGS.head(obj.key);
          if (head?.customMetadata?.fileHash === fileHash) {
            return jsonResponse({ error: "This flight has already been uploaded" }, 409);
          }
        }
      }

      // Store in R2: incoming/<user_id>/<timestamp>-<filename>.igc
      const timestamp = Date.now();
      const key = `incoming/${userId}/${timestamp}-${fileName}`;

      await env.TRACKLOGS.put(key, fileData, {
        customMetadata: {
          user_id: userId,
          uploaded_at: new Date().toISOString(),
          original_filename: fileName,
          fileHash,
        },
      });

      // Count pending files for this user
      const listed = await env.TRACKLOGS.list({ prefix: `incoming/${userId}/` });
      const pendingCount = listed.objects.length;

      return jsonResponse({
        success: true,
        key,
        pendingCount,
        message: "Tracklog uploaded. It will be processed in the next daily build.",
      }, 200);

    } catch (err) {
      console.error("Upload error:", err);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};

// Extract the flight date from an IGC or GPX file's text content.
// IGC: HFDTEDATE:DDMMYY or HFDTEDDMMYY
// GPX: first <time>YYYY-MM-DD...</time> in a track point
function extractFlightDate(text) {
  const igcMatch = text.match(/HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
  if (igcMatch) {
    const [, dd, mm, yy] = igcMatch;
    return new Date(`20${yy}-${mm}-${dd}`);
  }
  const gpxMatch = text.match(/<time>(\d{4}-\d{2}-\d{2})/);
  if (gpxMatch) {
    return new Date(gpxMatch[1]);
  }
  return null;
}

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