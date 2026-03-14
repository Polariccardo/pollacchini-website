// netlify/functions/get-content.js
// Fetches published Articles and Weekly Briefs from Notion at request time.
// Called by the frontend on page load to populate dynamic content.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function queryDatabase(databaseId, token) {
  const response = await fetch(`${NOTION_API}/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        property: "Status",
        select: { equals: "Published" }
      },
      sorts: [{ property: "Date", direction: "descending" }]
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion API error ${response.status}: ${err}`);
  }

  return response.json();
}

function extractText(richText) {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map(t => t.plain_text || "").join("");
}

function formatArticle(page, index) {
  const props = page.properties;
  return {
    id: page.id,
    num: String(index + 1).padStart(2, "0"),
    title: extractText(props.Title?.title),
    category: extractText(props.Category?.rich_text),
    readTime: extractText(props.ReadTime?.rich_text) || "",
    date: props.Date?.date?.start || "",
    slug: extractText(props.Slug?.rich_text),
    body: extractText(props.Body?.rich_text),
  };
}

function formatWeeklyBrief(page) {
  const props = page.properties;
  return {
    id: page.id,
    issue: props.Issue?.number || 0,
    title: extractText(props.Title?.title),
    date: props.Date?.date?.start || "",
    body: extractText(props.Body?.rich_text),
    excerpt: extractText(props.Body?.rich_text).slice(0, 160) + "…",
  };
}

export const handler = async (event) => {
  const token = process.env.NOTION_TOKEN;
  const articlesDbId = process.env.NOTION_ARTICLES_DB;
  const weeklyDbId = process.env.NOTION_WEEKLY_DB;

  if (!token || !articlesDbId || !weeklyDbId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing Notion environment variables" }),
    };
  }

  try {
    const [articlesRes, weeklyRes] = await Promise.all([
      queryDatabase(articlesDbId, token),
      queryDatabase(weeklyDbId, token),
    ]);

    const articles = articlesRes.results.map(formatArticle);
    const weekly = weeklyRes.results.map(formatWeeklyBrief);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60", // cache for 60s
      },
      body: JSON.stringify({ articles, weekly }),
    };
  } catch (err) {
    console.error("get-content error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
