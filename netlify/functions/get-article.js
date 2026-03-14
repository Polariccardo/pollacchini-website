// netlify/functions/get-article.js
// Fetches a single published article by slug from Notion.
// Called by article.html: /article?slug=finance-impact-pyramid

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function extractText(richText) {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map(t => t.plain_text || "").join("");
}

function decodeTags(text) {
  if (!text) return text;
  return text
    .replace(/\[em\]/g, '<em>')
    .replace(/\[\/em\]/g, '</em>')
    .replace(/\[hl\]/g, '<span class="hl"><span>')
    .replace(/\[\/hl\]/g, '</span></span>');
}

export const handler = async (event) => {
  const slug = event.queryStringParameters?.slug;

  if (!slug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "slug parameter is required" }),
    };
  }

  const token = process.env.NOTION_TOKEN;
  const articlesDbId = process.env.NOTION_ARTICLES_DB;

  if (!token || !articlesDbId) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing Notion environment variables" }),
    };
  }

  try {
    const response = await fetch(`${NOTION_API}/databases/${articlesDbId}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Status", select: { equals: "Published" } },
            { property: "Slug", rich_text: { equals: slug } },
          ]
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Notion API error ${response.status}`);
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Article not found" }),
      };
    }

    const page = data.results[0];
    const props = page.properties;

    const titleFormatted = extractText(props.TitleFormatted?.rich_text);
    const bodyFormatted = extractText(props.BodyFormatted?.rich_text);

    const article = {
      id: page.id,
      title: decodeTags(titleFormatted || extractText(props.Title?.title)),
      category: extractText(props.Category?.rich_text),
      readTime: extractText(props.ReadTime?.rich_text),
      date: props.Date?.date?.start || "",
      slug: extractText(props.Slug?.rich_text),
      body: decodeTags(bodyFormatted || extractText(props.Body?.rich_text)),
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60",
      },
      body: JSON.stringify({ article }),
    };
  } catch (err) {
    console.error("get-article error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
