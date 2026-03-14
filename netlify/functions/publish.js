// netlify/functions/publish.js
// Triggers a Netlify rebuild.
// Accepts GET with secret token in URL — low risk (triggers rebuild only, no data access).

export const handler = async (event) => {
  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK;
  const publishSecret = process.env.PUBLISH_SECRET;

  if (event.httpMethod === "GET") {
    const token = event.queryStringParameters?.token;
    if (!publishSecret || token !== publishSecret) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }
  } else if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!buildHookUrl) {
    return { statusCode: 500, body: JSON.stringify({ error: "Build hook not configured" }) };
  }

  try {
    const response = await fetch(buildHookUrl, { method: "POST" });
    if (!response.ok) throw new Error(`Build hook responded with ${response.status}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Site rebuild triggered" }),
    };
  } catch (err) {
    console.error("publish error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
