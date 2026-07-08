const express = require("express");
const axios = require("axios"); // Axios or standard fetch is fine. Node has built-in fetch in newer versions.

const router = express.Router();

// CORS Proxy for local Screenpipe REST API (running by default on http://localhost:3030)
// This endpoint lets the client browser query Screenpipe safely without CORS blocks.
router.get("/search", async (req, res) => {
  const { q = "", contentType = "all", limit = 20, hours = 1 } = req.query;
  const screenpipeUrl = req.query.url || "http://localhost:3030";
  
  try {
    // Standard URL parameters for Screenpipe /search
    const params = new URLSearchParams({
      q: String(q),
      limit: String(limit),
    });

    if (contentType === "ocr" || contentType === "audio") {
      params.append("content_type", contentType);
    }
    
    if (hours) {
      // Calculate start_time based on hours
      const startTime = new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString();
      params.append("start_time", startTime);
    }

    const targetUrl = `${screenpipeUrl}/search?${params.toString()}`;
    
    // Node built-in fetch (available in Node 18+)
    const response = await fetch(targetUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: `Screenpipe responded with status ${response.status}` });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Screenpipe proxy error:", err.message);
    res.status(502).json({
      error: "Could not connect to Screenpipe.",
      message: err.message,
      hint: "Make sure Screenpipe is running on your machine (default port 3030)."
    });
  }
});

module.exports = router;
