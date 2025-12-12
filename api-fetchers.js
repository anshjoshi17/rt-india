// api-fetchers.js - GNews and NewsAPI fetching module

/* -------------------- NEWSAPI.org Integration -------------------- */
async function fetchFromNewsAPI(params) {
  try {
    const { q, language, pageSize, sortBy, from } = params;
    const apiKey = process.env.NEWSAPI_KEY;

    if (!apiKey) {
      console.warn("NEWSAPI_KEY not configured, skipping NewsAPI");
      return [];
    }

    let url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=${language || 'hi'}&pageSize=${pageSize || 10}&sortBy=${sortBy || 'publishedAt'}&apiKey=${apiKey}`;

    if (from) {
      url += `&from=${from}`;
    } else {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      url += `&from=${yesterday.split('T')[0]}`;
    }

    console.log(`📡 Fetching LATEST from NewsAPI: ${q} (lang=${language || 'hi'})`);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NewsAPI HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();

    if (data.status !== "ok") {
      console.warn(`NewsAPI error: ${data.message}`);
      return [];
    }

    let articles = data.articles || [];
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });

    console.log(`✅ NewsAPI returned ${articles.length} LATEST articles`);

    if (articles.length > 0) {
      const latestDate = new Date(articles[0].publishedAt).toLocaleString('hi-IN');
      console.log(`   📅 Latest article: ${latestDate}`);
    }

    return articles;

  } catch (error) {
    console.warn(`❌ NewsAPI fetch failed:`, error.message);
    return [];
  }
}

/* -------------------- GNews.io Integration -------------------- */
async function fetchFromGNewsAPI(params) {
  try {
    const { q, lang, country, max, sortby } = params;
    const apiKey = process.env.GNEWS_API_KEY;

    if (!apiKey) {
      console.warn("GNEWS_API_KEY not configured, skipping GNews");
      return [];
    }

    const baseUrl = country ?
      `https://gnews.io/api/v4/top-headlines?q=${encodeURIComponent(q)}&lang=${lang || 'hi'}&country=${country}&max=${max || 10}&apikey=${apiKey}` :
      `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=${lang || 'hi'}&max=${max || 10}&apikey=${apiKey}`;

    let url = baseUrl;
    if (sortby) {
      url += `&sortby=${sortby}`;
    }

    console.log(`📡 Fetching LATEST from GNews: ${q} (lang=${lang || 'hi'})`);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();

    let articles = data.articles || [];

    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0);
      const dateB = new Date(b.publishedAt || 0);
      return dateB - dateA;
    });

    console.log(`✅ GNews returned ${articles.length} LATEST articles`);

    if (articles.length > 0) {
      const latestDate = new Date(articles[0].publishedAt).toLocaleString('hi-IN');
      console.log(`   📅 Latest article: ${latestDate}`);
    }

    return articles;

  } catch (error) {
    console.warn(`❌ GNews fetch failed:`, error.message);
    return [];
  }
}

/* -------------------- API Sources -------------------- */
const API_SOURCES = {
  INDIA_GNEWS_HI: {
    priority: 4,
    name: "GNews India (Hindi)",
    type: "GNEWS",
    config: {
      q: "भारत OR India",
      lang: "hi",
      country: "in",
      max: 15,
      sortby: "publishedAt"
    }
  },

  INTERNATIONAL_GNEWS: {
    priority: 5,
    name: "International News (GNews)",
    type: "GNEWS",
    config: {
      q: "world OR international",
      lang: "en", // fetch in English, then rewrite to Hindi
      max: 10,
      sortby: "publishedAt"
    }
  },

  INTERNATIONAL_NEWSAPI: {
    priority: 6,
    name: "World News (NewsAPI)",
    type: "NEWSAPI",
    config: {
      q: "world OR international",
      language: "en",
      pageSize: 10,
      sortBy: "publishedAt",
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }
  }
};

/* -------------------- API-Specific Normalization -------------------- */
function normalizeNewsAPIArticle(apiArticle, sourceConfig) {
  return {
    title: apiArticle.title || 'No Title',
    description: apiArticle.description || apiArticle.content || '',
    url: apiArticle.url,
    image: apiArticle.urlToImage,
    pubDate: apiArticle.publishedAt,
    source: apiArticle.source?.name || sourceConfig.name,
    meta: {
      api: "NEWSAPI",
      sourceName: sourceConfig.name,
      isLatest: true
    }
  };
}

function normalizeGNewsArticle(apiArticle, sourceConfig) {
  return {
    title: apiArticle.title || 'No Title',
    description: apiArticle.description || apiArticle.content || '',
    url: apiArticle.url,
    image: apiArticle.image,
    pubDate: apiArticle.publishedAt,
    source: apiArticle.source?.name || sourceConfig.name,
    meta: {
      api: "GNEWS",
      sourceName: sourceConfig.name,
      isLatest: true
    }
  };
}

/* -------------------- Export -------------------- */
module.exports = {
  fetchFromNewsAPI,
  fetchFromGNewsAPI,
  API_SOURCES,
  normalizeNewsAPIArticle,
  normalizeGNewsArticle
};