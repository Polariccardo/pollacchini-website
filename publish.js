// netlify/functions/publish.js
// Triggers a Netlify rebuild when called. 
// This is what fires when you say "publish" in the chat.

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const buildHookUrl = process.env.NETLIFY_BUILD_HOOK;

  if (!buildHookUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Build hook not configured" }),
    };
  }

  try {
    const response = await fetch(buildHookUrl, { method: "POST" });

    if (!response.ok) {
      throw new Error(`Build hook responded with ${response.status}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Site rebuild triggered" }),
    };
  } catch (err) {
    console.error("publish error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
