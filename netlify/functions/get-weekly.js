// netlify/functions/get-weekly.js
// Fetches a single published weekly brief by issue number from Notion.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function extractText(richText) {
  if (!richText || !Array.isArray(richText)) return "";
  return richText.map(t => t.plain_text || "").join("");
}

export const handler = async (event) => {
  const issue = event.queryStringParameters?.issue;

  if (!issue) {
    return { statusCode: 400, body: JSON.stringify({ error: "issue parameter is required" }) };
  }

  const token = process.env.NOTION_TOKEN;
  const weeklyDbId = process.env.NOTION_WEEKLY_DB;

  if (!token || !weeklyDbId) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing Notion environment variables" }) };
  }

  try {
    const response = await fetch(`${NOTION_API}/databases/${weeklyDbId}/query`, {
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
            { property: "Issue", number: { equals: Number(issue) } },
          ]
        }
      }),
    });

    if (!response.ok) throw new Error(`Notion API error ${response.status}`);

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Brief not found" }) };
    }

    const page = data.results[0];
    const props = page.properties;

    const brief = {
      id: page.id,
      issue: props.Issue?.number || 0,
      title: extractText(props.Title?.title),
      headline: extractText(props.Headline?.rich_text),
      date: props.Date?.date?.start || "",
      trending: extractText(props.Trending?.rich_text),
      arr: extractText(props.ARR?.rich_text),
      marginGuardrails: extractText(props.MarginGuardrails?.rich_text),
      capitalStructure: extractText(props.CapitalStructure?.rich_text),
      innovation: extractText(props.Innovation?.rich_text),
      cfoQuestions: extractText(props.CFOQuestions?.rich_text),
      mustRead: extractText(props.MustRead?.rich_text),
      sources: extractText(props.Sources?.rich_text),
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=60" },
      body: JSON.stringify({ brief }),
    };
  } catch (err) {
    console.error("get-weekly error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
