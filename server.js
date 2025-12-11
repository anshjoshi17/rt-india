/* -------------------- UTTARAKHAND SPECIFIC ENDPOINTS -------------------- */

app.get("/api/uttarakhand-news", async (req, res) => {
  try {
    const { limit = 30, genre, page = 1 } = req.query;
    const pageSize = Math.min(Number(limit), 100);
    const pageNum = Math.max(Number(page), 1);
    const offset = (pageNum - 1) * pageSize;

    // Build query for Uttarakhand news
    let query = supabase
      .from("ai_news")
      .select("id,title,slug,short_desc,image_url,region,genre,published_at,created_at,meta", { count: "exact" })
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (genre && genre !== "all") query = query.eq("genre", genre);

    const { data, error, count } = await query;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    res.json({
      success: true,
      data: data || [],
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: count || 0,
        totalPages: count ? Math.ceil(count / pageSize) : 0
      },
      meta: {
        region: "uttarakhand",
        description: "Latest Uttarakhand news from all districts",
        total_news: count || 0,
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/uttarakhand/stats", async (req, res) => {
  try {
    // Get Uttarakhand specific stats
    const { data, error } = await supabase
      .from("ai_news")
      .select("genre, created_at, meta, title")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const stats = {
      total: data?.length || 0,
      byGenre: {},
      latestArticle: null,
      sources: {},
      wordStats: {
        totalWords: 0,
        averageWords: 0
      }
    };

    let latestDate = new Date(0);
    const uttarakhandKeywords = [
      "dehradun", "haridwar", "rishikesh", "nainital", "almora",
      "uttarakhand", "गढ़वाल", "कुमाऊं", "देहरादून", "हरिद्वार",
      "मसूरी", "ऋषिकेश", "कोटद्वार", "रुद्रप्रयाग", "चमोली",
      "पौड़ी", "उत्तरकाशी", "टिहरी", "चंपावत", "पिथौरागढ़"
    ];
    
    let relevantCount = 0;

    data?.forEach(item => {
      // Count by genre
      const genre = item.genre || "Other";
      stats.byGenre[genre] = (stats.byGenre[genre] || 0) + 1;
      
      // Count by source
      const sourceName = item.meta?.source_name || "unknown";
      stats.sources[sourceName] = (stats.sources[sourceName] || 0) + 1;
      
      // Word count
      const wordCount = item.meta?.word_count || 0;
      stats.wordStats.totalWords += wordCount;
      
      // Check if content is relevant to Uttarakhand
      const content = item.title + " " + (item.meta?.original_title || "");
      const isRelevant = uttarakhandKeywords.some(keyword => 
        content.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isRelevant) relevantCount++;
      
      // Track latest article
      const itemDate = new Date(item.created_at);
      if (itemDate > latestDate) {
        latestDate = itemDate;
        stats.latestArticle = {
          time: item.created_at,
          age: Math.floor((Date.now() - itemDate.getTime()) / (1000 * 60)) + " minutes ago",
          title: item.title.substring(0, 100)
        };
      }
    });

    if (data?.length > 0) {
      stats.wordStats.averageWords = Math.round(stats.wordStats.totalWords / data.length);
      stats.relevance_score = Math.round((relevantCount / data.length) * 100);
    }

    res.json({ 
      success: true, 
      stats,
      districts_coverage: [
        "Dehradun", "Haridwar", "Nainital", "Almora", "Pithoragarh",
        "Chamoli", "Uttarkashi", "Rudraprayag", "Pauri", "Champawat",
        "Bageshwar", "Udham Singh Nagar", "Tehri Garhwal"
      ]
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/uttarakhand/districts/:district", async (req, res) => {
  try {
    const district = req.params.district.toLowerCase();
    
    // District keywords mapping
    const districtKeywords = {
      "dehradun": ["dehradun", "dehra", "देहरादून", "गढ़वाल"],
      "haridwar": ["haridwar", "हरिद्वार", "गंगा", "हर की पौड़ी"],
      "nainital": ["nainital", "नैनीताल", "झील", "भीमताल"],
      "almora": ["almora", "अल्मोड़ा", "कुमाऊं"],
      "rishikesh": ["rishikesh", "ऋषिकेश", "योग", "गंगा"],
      "uttarkashi": ["uttarkashi", "उत्तरकाशी", "गंगोत्री", "यमुनोत्री"],
      "chamoli": ["chamoli", "चमोली", "बद्रीनाथ", "हेमकुंड"],
      "rudraprayag": ["rudraprayag", "रुद्रप्रयाग", "केदारनाथ"],
      "pauri": ["pauri", "पौड़ी", "गढ़वाल", "लैंसडाउन"],
      "pithoragarh": ["pithoragarh", "पिथौरागढ़", "कालापानी"],
      "bageshwar": ["bageshwar", "बागेश्वर"],
      "champawat": ["champawat", "चंपावत", "बनबसा"],
      "tehri": ["tehri", "टिहरी", "गढ़वाल", "धनोल्टी"],
      "udhamsinghnagar": ["udham singh nagar", "उधमसिंह नगर", "काशीपुर", "रुद्रपुर"],
      "all": ["uttarakhand", "उत्तराखंड", "गढ़वाल", "कुमाऊं"]
    };

    const keywords = districtKeywords[district] || [district];

    // Build query with district keywords
    let query = supabase
      .from("ai_news")
      .select("*")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%");
    
    // Add district-specific search if not "all"
    if (district !== "all") {
      const searchConditions = keywords.map(kw => 
        `title.ilike.%${kw}%,ai_content.ilike.%${kw}%,short_desc.ilike.%${kw}%`
      ).join(",");
      query = query.or(searchConditions);
    }
    
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Database error", details: error.message });
    }

    res.json({
      success: true,
      data: data || [],
      district: district,
      count: data?.length || 0,
      keywords: keywords
    });
  } catch (error) {
    console.error("API error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

app.get("/api/uttarakhand/breaking", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("ai_news")
      .select("title, slug, created_at")
      .or("region.eq.uttarakhand,meta->source_name->>0.ilike.%uttarakhand%,title.ilike.%uttarakhand%,title.ilike.%उत्तराखंड%")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      breaking_news: data || [],
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Breaking news error:", error);
    res.status(500).json({ 
      success: false, 
      error: "Server error",
      message: error.message 
    });
  }
});

// Serve Uttarakhand news page
app.get("/uttarakhand", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Uttarakhand News | RT-India - उत्तराखंड की ताज़ा खबरें</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@300;400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #1a5276;
                --primary-dark: #154360;
                --secondary: #d35400;
                --accent: #27ae60;
                --light: #f8f9fa;
                --dark: #2c3e50;
                --gray: #7f8c8d;
                --border: #e0e0e0;
                --shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
                --shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.12);
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Poppins', 'Noto Sans Devanagari', sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f5f7fa;
            }

            .hindi-text {
                font-family: 'Noto Sans Devanagari', sans-serif;
            }

            /* Header Styles */
            .header {
                background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
                color: white;
                padding: 1rem 0;
                box-shadow: var(--shadow);
                position: sticky;
                top: 0;
                z-index: 1000;
            }

            .header-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .logo {
                display: flex;
                align-items: center;
                gap: 10px;
                text-decoration: none;
                color: white;
            }

            .logo-icon {
                font-size: 2rem;
                color: var(--secondary);
            }

            .logo-text h1 {
                font-size: 1.8rem;
                font-weight: 700;
            }

            .logo-text span {
                font-size: 0.9rem;
                opacity: 0.9;
                font-weight: 300;
            }

            .nav-links {
                display: flex;
                gap: 2rem;
                list-style: none;
            }

            .nav-links a {
                color: white;
                text-decoration: none;
                font-weight: 500;
                font-size: 1.1rem;
                padding: 0.5rem 1rem;
                border-radius: 4px;
                transition: all 0.3s ease;
            }

            .nav-links a:hover {
                background-color: rgba(255, 255, 255, 0.1);
                transform: translateY(-2px);
            }

            .nav-links a.active {
                background-color: var(--secondary);
                color: white;
            }

            /* Uttarakland Hero Section */
            .uttarakhand-hero {
                background: linear-gradient(rgba(26, 82, 118, 0.85), rgba(21, 67, 96, 0.9)), 
                            url('https://images.unsplash.com/photo-1548013146-72479768bada?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80');
                background-size: cover;
                background-position: center;
                color: white;
                padding: 4rem 0;
                text-align: center;
                margin-bottom: 2rem;
            }

            .hero-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
            }

            .hero-title {
                font-size: 3.5rem;
                font-weight: 700;
                margin-bottom: 1rem;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            }

            .hero-subtitle {
                font-size: 1.4rem;
                max-width: 800px;
                margin: 0 auto 2rem;
                opacity: 0.95;
            }

            .stats {
                display: flex;
                justify-content: center;
                gap: 3rem;
                margin-top: 2rem;
            }

            .stat-item {
                text-align: center;
            }

            .stat-number {
                font-size: 2.5rem;
                font-weight: 700;
                color: var(--secondary);
                display: block;
            }

            .stat-label {
                font-size: 1rem;
                opacity: 0.9;
            }

            /* Main Content */
            .main-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px 40px;
                display: grid;
                grid-template-columns: 1fr 300px;
                gap: 2rem;
            }

            /* Filter Section */
            .filter-section {
                background: white;
                padding: 1.5rem;
                border-radius: 12px;
                box-shadow: var(--shadow);
                margin-bottom: 2rem;
                display: flex;
                gap: 1rem;
                align-items: center;
                flex-wrap: wrap;
            }

            .filter-btn {
                padding: 0.5rem 1.5rem;
                border: 2px solid var(--border);
                background: white;
                border-radius: 25px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.3s ease;
            }

            .filter-btn:hover {
                border-color: var(--primary);
                color: var(--primary);
            }

            .filter-btn.active {
                background: var(--primary);
                color: white;
                border-color: var(--primary);
            }

            .refresh-btn {
                background: var(--accent);
                color: white;
                border: none;
                padding: 0.5rem 1.5rem;
                border-radius: 25px;
                cursor: pointer;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.3s ease;
            }

            .refresh-btn:hover {
                background: #219653;
                transform: translateY(-2px);
            }

            /* News Grid */
            .news-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                gap: 2rem;
                margin-bottom: 2rem;
            }

            .news-card {
                background: white;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: var(--shadow);
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
            }

            .news-card:hover {
                transform: translateY(-8px);
                box-shadow: var(--shadow-hover);
            }

            .news-image {
                height: 200px;
                overflow: hidden;
                position: relative;
            }

            .news-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.5s ease;
            }

            .news-card:hover .news-image img {
                transform: scale(1.05);
            }

            .news-content {
                padding: 1.5rem;
                flex-grow: 1;
                display: flex;
                flex-direction: column;
            }

            .news-category {
                display: inline-block;
                background: var(--primary);
                color: white;
                padding: 0.3rem 1rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                margin-bottom: 1rem;
                align-self: flex-start;
            }

            .news-title {
                font-size: 1.3rem;
                font-weight: 600;
                margin-bottom: 1rem;
                line-height: 1.4;
                color: var(--dark);
            }

            .news-desc {
                color: var(--gray);
                margin-bottom: 1.5rem;
                flex-grow: 1;
                font-size: 0.95rem;
            }

            .news-meta {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: auto;
                padding-top: 1rem;
                border-top: 1px solid var(--border);
            }

            .news-source {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
                color: var(--gray);
            }

            .news-time {
                font-size: 0.9rem;
                color: var(--gray);
            }

            .read-more {
                color: var(--secondary);
                text-decoration: none;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                transition: gap 0.3s ease;
            }

            .read-more:hover {
                gap: 10px;
            }

            /* Loading State */
            .loading {
                text-align: center;
                padding: 3rem;
                grid-column: 1 / -1;
            }

            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 5px solid var(--border);
                border-top-color: var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 1rem;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            /* Sidebar */
            .sidebar {
                display: flex;
                flex-direction: column;
                gap: 2rem;
            }

            .sidebar-section {
                background: white;
                border-radius: 12px;
                padding: 1.5rem;
                box-shadow: var(--shadow);
            }

            .section-title {
                font-size: 1.2rem;
                font-weight: 600;
                margin-bottom: 1.5rem;
                padding-bottom: 0.5rem;
                border-bottom: 2px solid var(--primary);
                color: var(--primary);
            }

            .top-districts {
                display: flex;
                flex-wrap: wrap;
                gap: 0.8rem;
            }

            .district-tag {
                padding: 0.5rem 1rem;
                background: #e8f4fc;
                border-radius: 20px;
                font-size: 0.9rem;
                color: var(--primary);
                font-weight: 500;
                transition: all 0.3s ease;
                cursor: pointer;
            }

            .district-tag:hover {
                background: var(--primary);
                color: white;
            }

            .quick-link {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 0.8rem;
                border-radius: 8px;
                color: var(--dark);
                text-decoration: none;
                transition: all 0.3s ease;
                margin-bottom: 0.5rem;
            }

            .quick-link:hover {
                background: var(--light);
                color: var(--primary);
                padding-left: 1rem;
            }

            .quick-link i {
                color: var(--primary);
                width: 20px;
            }

            /* Footer */
            .footer {
                background: var(--dark);
                color: white;
                padding: 3rem 0 2rem;
                margin-top: 4rem;
            }

            .footer-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 20px;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 2rem;
            }

            .footer-section h3 {
                font-size: 1.2rem;
                margin-bottom: 1.5rem;
                color: var(--secondary);
            }

            .footer-links {
                list-style: none;
            }

            .footer-links li {
                margin-bottom: 0.8rem;
            }

            .footer-links a {
                color: #ddd;
                text-decoration: none;
                transition: color 0.3s ease;
            }

            .footer-links a:hover {
                color: var(--secondary);
            }

            .copyright {
                text-align: center;
                padding-top: 2rem;
                margin-top: 2rem;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                color: #aaa;
                font-size: 0.9rem;
            }

            /* Back to Top */
            .back-to-top {
                position: fixed;
                bottom: 30px;
                right: 30px;
                background: var(--primary);
                color: white;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                text-decoration: none;
                box-shadow: var(--shadow);
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
                z-index: 100;
            }

            .back-to-top.visible {
                opacity: 1;
                transform: translateY(0);
            }

            .back-to-top:hover {
                background: var(--primary-dark);
                transform: translateY(-5px);
            }

            /* Responsive Design */
            @media (max-width: 992px) {
                .main-container {
                    grid-template-columns: 1fr;
                }
                
                .hero-title {
                    font-size: 2.8rem;
                }
            }

            @media (max-width: 768px) {
                .header-container {
                    flex-direction: column;
                    gap: 1rem;
                }
                
                .nav-links {
                    gap: 1rem;
                }
                
                .hero-title {
                    font-size: 2.2rem;
                }
                
                .hero-subtitle {
                    font-size: 1.1rem;
                }
                
                .news-grid {
                    grid-template-columns: 1fr;
                }
                
                .stats {
                    flex-direction: column;
                    gap: 1.5rem;
                }
            }

            @media (max-width: 480px) {
                .filter-section {
                    flex-direction: column;
                    align-items: stretch;
                }
                
                .filter-btn, .refresh-btn {
                    width: 100%;
                    text-align: center;
                }
            }

            /* Weather Widget */
            .weather-widget {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 12px;
                padding: 1.5rem;
                margin-bottom: 1rem;
            }

            .weather-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 1rem;
            }

            .weather-temp {
                font-size: 2.5rem;
                font-weight: 700;
            }

            .weather-desc {
                font-size: 1.1rem;
                opacity: 0.9;
            }

            .weather-details {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1rem;
                margin-top: 1rem;
            }

            .weather-detail {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
            }

            .weather-detail i {
                width: 20px;
            }

            /* Breaking News Banner */
            .breaking-news {
                background: linear-gradient(90deg, #ff6b6b 0%, #ee5a24 100%);
                color: white;
                padding: 0.8rem;
                margin-bottom: 2rem;
                border-radius: 8px;
                display: flex;
                align-items: center;
                gap: 15px;
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.8; }
                100% { opacity: 1; }
            }

            .breaking-label {
                background: white;
                color: #ff6b6b;
                padding: 0.3rem 1rem;
                border-radius: 20px;
                font-weight: 700;
                font-size: 0.9rem;
                white-space: nowrap;
            }

            .breaking-text {
                flex-grow: 1;
                font-weight: 500;
                overflow: hidden;
            }

            .marquee {
                overflow: hidden;
                white-space: nowrap;
                width: 100%;
            }

            .marquee span {
                display: inline-block;
                padding-left: 100%;
                animation: marquee 30s linear infinite;
            }

            @keyframes marquee {
                0% { transform: translate(0, 0); }
                100% { transform: translate(-100%, 0); }
            }

            /* Video Indicator */
            .video-indicator {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(255, 0, 0, 0.8);
                color: white;
                padding: 0.3rem 0.6rem;
                border-radius: 4px;
                font-size: 0.8rem;
                display: flex;
                align-items: center;
                gap: 5px;
                z-index: 2;
            }
        </style>
    </head>
    <body>
        <!-- Header -->
        <header class="header">
            <div class="header-container">
                <a href="/" class="logo">
                    <div class="logo-icon">
                        <i class="fas fa-newspaper"></i>
                    </div>
                    <div class="logo-text">
                        <h1>RT-India</h1>
                        <span>Real Time News Updates</span>
                    </div>
                </a>
                <nav>
                    <ul class="nav-links">
                        <li><a href="/">Home</a></li>
                        <li><a href="/uttarakhand" class="active">Uttarakhand</a></li>
                        <li><a href="/api/news">All News</a></li>
                        <li><a href="#about">About</a></li>
                    </ul>
                </nav>
            </div>
        </header>

        <!-- Breaking News Banner -->
        <div class="breaking-news">
            <div class="breaking-label">BREAKING</div>
            <div class="marquee">
                <span id="breakingNewsText">Loading latest Uttarakhand news...</span>
            </div>
        </div>

        <!-- Uttarakhand Hero Section -->
        <section class="uttarakhand-hero">
            <div class="hero-container">
                <h1 class="hero-title hindi-text">उत्तराखंड समाचार</h1>
                <p class="hero-subtitle hindi-text">देवभूमि की ताज़ा खबरें, राजनीति, मौसम, और सम्पूर्ण जानकारी</p>
                <div class="stats">
                    <div class="stat-item">
                        <span class="stat-number" id="newsCount">0</span>
                        <span class="stat-label hindi-text">ताज़ा खबरें</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" id="updatedTime">0</span>
                        <span class="stat-label">Minutes Ago</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number hindi-text">१३</span>
                        <span class="stat-label hindi-text">जिले कवर</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- Main Content -->
        <div class="main-container">
            <!-- Main News Section -->
            <main class="main-content">
                <!-- Filter Section -->
                <div class="filter-section">
                    <button class="filter-btn active" data-filter="all">All News</button>
                    <button class="filter-btn" data-filter="Politics">Politics</button>
                    <button class="filter-btn" data-filter="Crime">Crime</button>
                    <button class="filter-btn" data-filter="Environment">Environment</button>
                    <button class="filter-btn" data-filter="Weather">Weather</button>
                    <button class="refresh-btn" id="refreshNews">
                        <i class="fas fa-sync-alt"></i> Refresh News
                    </button>
                </div>

                <!-- News Grid -->
                <div class="news-grid" id="newsGrid">
                    <!-- News cards will be dynamically inserted here -->
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <p class="hindi-text">उत्तराखंड समाचार लोड हो रहे हैं...</p>
                    </div>
                </div>
            </main>

            <!-- Sidebar -->
            <aside class="sidebar">
                <!-- Weather Widget -->
                <div class="weather-widget">
                    <div class="weather-header">
                        <div>
                            <h3><i class="fas fa-map-marker-alt"></i> Dehradun</h3>
                            <p class="weather-desc hindi-text">आंशिक रूप से धूप</p>
                        </div>
                        <div class="weather-temp">24°C</div>
                    </div>
                    <div class="weather-details">
                        <div class="weather-detail">
                            <i class="fas fa-wind"></i>
                            <span>हवा: 12 km/h</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-tint"></i>
                            <span>नमी: 65%</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-sun"></i>
                            <span>दृश्यता: 10 km</span>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-thermometer-half"></i>
                            <span>Feels: 26°C</span>
                        </div>
                    </div>
                </div>

                <!-- Top Districts -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">प्रमुख जिले</h3>
                    <div class="top-districts">
                        <span class="district-tag hindi-text" data-district="dehradun">देहरादून</span>
                        <span class="district-tag hindi-text" data-district="haridwar">हरिद्वार</span>
                        <span class="district-tag hindi-text" data-district="rishikesh">ऋषिकेश</span>
                        <span class="district-tag hindi-text" data-district="nainital">नैनीताल</span>
                        <span class="district-tag hindi-text" data-district="almora">अल्मोड़ा</span>
                        <span class="district-tag hindi-text" data-district="pithoragarh">पिथौरागढ़</span>
                        <span class="district-tag hindi-text" data-district="chamoli">चमोली</span>
                        <span class="district-tag hindi-text" data-district="uttarkashi">उत्तरकाशी</span>
                        <span class="district-tag hindi-text" data-district="rudraprayag">रुद्रप्रयाग</span>
                        <span class="district-tag hindi-text" data-district="pauri">पौड़ी</span>
                    </div>
                </div>

                <!-- Quick Links -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">जल्दी पहुंच</h3>
                    <a href="/api/uttarakhand-news" class="quick-link">
                        <i class="fas fa-rss"></i>
                        <span class="hindi-text">सभी समाचार</span>
                    </a>
                    <a href="/api/uttarakhand/stats" class="quick-link">
                        <i class="fas fa-chart-bar"></i>
                        <span class="hindi-text">आंकड़े</span>
                    </a>
                    <a href="/api/uttarakhand/breaking" class="quick-link">
                        <i class="fas fa-bolt"></i>
                        <span class="hindi-text">ब्रेकिंग न्यूज़</span>
                    </a>
                    <a href="/api/news" class="quick-link">
                        <i class="fas fa-globe"></i>
                        <span class="hindi-text">सभी राज्य</span>
                    </a>
                    <a href="/health" class="quick-link">
                        <i class="fas fa-heartbeat"></i>
                        <span class="hindi-text">सेवा स्थिति</span>
                    </a>
                </div>

                <!-- Latest Updates -->
                <div class="sidebar-section">
                    <h3 class="section-title hindi-text">ताज़ा अपडेट</h3>
                    <div id="latestUpdates">
                        <p class="hindi-text" style="color: var(--gray); font-size: 0.9rem;">
                            लोड हो रहा है...
                        </p>
                    </div>
                </div>
            </aside>
        </div>

        <!-- Footer -->
        <footer class="footer">
            <div class="footer-container">
                <div class="footer-section">
                    <h3 class="hindi-text">RT-India उत्तराखंड</h3>
                    <p class="hindi-text">देवभूमि की ताज़ा और विश्वसनीय खबरें। राजनीति, मौसम, पर्यटन और समाज से जुड़ी हर खबर आप तक पहुँचाना हमारा उद्देश्य है।</p>
                </div>
                <div class="footer-section">
                    <h3 class="hindi-text">त्वरित लिंक</h3>
                    <ul class="footer-links">
                        <li><a href="/api/uttarakhand-news" class="hindi-text">उत्तराखंड समाचार</a></li>
                        <li><a href="/api/uttarakhand/stats" class="hindi-text">आंकड़े</a></li>
                        <li><a href="/api/uttarakhand/breaking" class="hindi-text">ब्रेकिंग न्यूज़</a></li>
                        <li><a href="/api/news" class="hindi-text">सभी समाचार</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3 class="hindi-text">संपर्क करें</h3>
                    <ul class="footer-links">
                        <li><i class="fas fa-server"></i> API Status: <span id="apiStatus">Checking...</span></li>
                        <li><i class="fas fa-clock"></i> Last Updated: <span id="lastApiUpdate">Loading...</span></li>
                        <li><i class="fas fa-database"></i> Total News: <span id="totalNewsCount">0</span></li>
                    </ul>
                </div>
            </div>
            <div class="copyright">
                <p>© 2024 RT-India उत्तराखंड. सर्वाधिकार सुरक्षित।</p>
                <p class="hindi-text" style="margin-top: 0.5rem;">स्वचालित समाचार संकलन सेवा - प्रति ${process.env.POLL_MINUTES || 15} मिनट अपडेट</p>
            </div>
        </footer>

        <!-- Back to Top Button -->
        <a href="#" class="back-to-top" id="backToTop">
            <i class="fas fa-arrow-up"></i>
        </a>

        <script>
            // Configuration
            const API_BASE_URL = window.location.origin; // Use same origin
            const UPDATE_INTERVAL = 300000; // 5 minutes
            
            // DOM Elements
            const newsGrid = document.getElementById('newsGrid');
            const newsCount = document.getElementById('newsCount');
            const updatedTime = document.getElementById('updatedTime');
            const refreshBtn = document.getElementById('refreshNews');
            const filterBtns = document.querySelectorAll('.filter-btn');
            const backToTop = document.getElementById('backToTop');
            const breakingNewsText = document.getElementById('breakingNewsText');
            const apiStatus = document.getElementById('apiStatus');
            const lastApiUpdate = document.getElementById('lastApiUpdate');
            const totalNewsCount = document.getElementById('totalNewsCount');

            // State
            let allNews = [];
            let currentFilter = 'all';
            let lastUpdateTime = new Date();

            // Format date to relative time
            function formatRelativeTime(dateString) {
                const date = new Date(dateString);
                const now = new Date();
                const diffMs = now - date;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);

                if (diffMins < 1) return 'अभी अभी';
                if (diffMins < 60) return \`\${diffMins} मिनट पहले\`;
                if (diffHours < 24) return \`\${diffHours} घंटे पहले\`;
                if (diffDays < 7) return \`\${diffDays} दिन पहले\`;
                return date.toLocaleDateString('hi-IN');
            }

            // Create news card HTML
            function createNewsCard(article) {
                const hasVideo = article.meta?.has_videos || false;
                const category = article.genre || 'Other';
                const categoryHindi = {
                    'Politics': 'राजनीति',
                    'Crime': 'अपराध',
                    'Environment': 'पर्यावरण',
                    'Weather': 'मौसम',
                    'Sports': 'खेल',
                    'Entertainment': 'मनोरंजन',
                    'Business': 'व्यापार',
                    'Health': 'स्वास्थ्य',
                    'Education': 'शिक्षा',
                    'Other': 'अन्य'
                }[category] || 'अन्य';

                return \`
                    <div class="news-card" data-category="\${category.toLowerCase()}">
                        <div class="news-image">
                            \${hasVideo ? '<div class="video-indicator"><i class="fas fa-play-circle"></i> वीडियो</div>' : ''}
                            <img src="\${article.image_url || 'https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'}" 
                                 alt="\${article.title}" 
                                 onerror="this.src='https://images.unsplash.com/photo-1548013146-72479768bada?w=800&auto=format&fit=crop'">
                        </div>
                        <div class="news-content">
                            <span class="news-category hindi-text">\${categoryHindi}</span>
                            <h3 class="news-title hindi-text">\${article.title}</h3>
                            <p class="news-desc hindi-text">\${article.short_desc || 'विस्तृत जानकारी के लिए पढ़ें...'}</p>
                            <div class="news-meta">
                                <div class="news-source">
                                    <i class="fas fa-newspaper"></i>
                                    <span>\${article.meta?.source_name || 'RT-India'}</span>
                                </div>
                                <div class="news-time hindi-text">
                                    \${formatRelativeTime(article.published_at || article.created_at)}
                                </div>
                            </div>
                            <a href="/api/news/\${article.slug}" target="_blank" class="read-more hindi-text">
                                पूरी खबर पढ़ें <i class="fas fa-arrow-right"></i>
                            </a>
                        </div>
                    </div>
                \`;
            }

            // Filter news by category
            function filterNews() {
                const filteredNews = currentFilter === 'all' 
                    ? allNews 
                    : allNews.filter(article => 
                        article.genre?.toLowerCase() === currentFilter.toLowerCase());

                newsGrid.innerHTML = filteredNews.length > 0 
                    ? filteredNews.map(createNewsCard).join('')
                    : \`<div class="loading">
                        <i class="fas fa-newspaper" style="font-size: 3rem; color: var(--gray); margin-bottom: 1rem;"></i>
                        <p class="hindi-text">\${currentFilter} श्रेणी में कोई समाचार नहीं मिला</p>
                    </div>\`;

                // Update news count
                newsCount.textContent = filteredNews.length;
            }

            // Fetch Uttarakhand news from API
            async function fetchUttarakhandNews() {
                try {
                    newsGrid.innerHTML = \`
                        <div class="loading">
                            <div class="loading-spinner"></div>
                            <p class="hindi-text">उत्तराखंड समाचार लोड हो रहे हैं...</p>
                        </div>
                    \`;

                    // Update API status
                    apiStatus.textContent = 'Loading...';
                    apiStatus.style.color = '#f39c12';
                    
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand-news?limit=50\`);
                    
                    if (!response.ok) {
                        throw new Error(\`HTTP error! status: \${response.status}\`);
                    }

                    const data = await response.json();
                    
                    if (data.success && data.data) {
                        // Sort by date (newest first)
                        allNews = data.data.sort((a, b) => 
                            new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at)
                        );
                        
                        // Update breaking news with latest headline
                        if (allNews.length > 0) {
                            breakingNewsText.textContent = allNews[0].title;
                        }
                        
                        // Update last update time
                        lastUpdateTime = new Date();
                        updatedTime.textContent = Math.floor((new Date() - lastUpdateTime) / 60000) || '0';
                        lastApiUpdate.textContent = new Date().toLocaleTimeString('hi-IN');
                        
                        // Update stats
                        totalNewsCount.textContent = data.meta?.total_news || allNews.length;
                        apiStatus.textContent = 'Online';
                        apiStatus.style.color = '#27ae60';
                        
                        // Update sidebar stats
                        updateSidebarStats();
                        
                        // Render news
                        filterNews();
                        
                        // Show success notification
                        showNotification('ताज़ा समाचार लोड हो गए!', 'success');
                    } else {
                        throw new Error('Invalid response format');
                    }
                } catch (error) {
                    console.error('Error fetching news:', error);
                    newsGrid.innerHTML = \`
                        <div class="loading">
                            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #e74c3c; margin-bottom: 1rem;"></i>
                            <p class="hindi-text">समाचार लोड करने में त्रुटि</p>
                            <p style="color: var(--gray); margin-top: 1rem;">कृपया बाद में पुनः प्रयास करें</p>
                        </div>
                    \`;
                    
                    apiStatus.textContent = 'Offline';
                    apiStatus.style.color = '#e74c3c';
                    
                    showNotification('समाचार लोड करने में असफल', 'error');
                }
            }

            // Update sidebar with latest updates
            async function updateSidebarStats() {
                const latestUpdates = document.getElementById('latestUpdates');
                const topNews = allNews.slice(0, 5);
                
                latestUpdates.innerHTML = topNews.map(article => \`
                    <div style="margin-bottom: 1rem; padding-bottom: 0.8rem; border-bottom: 1px solid var(--border);">
                        <a href="/api/news/\${article.slug}" 
                           target="_blank" 
                           style="color: var(--primary); text-decoration: none; font-weight: 500; display: block; margin-bottom: 0.3rem;"
                           class="hindi-text">
                           \${article.title.substring(0, 60)}...
                        </a>
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--gray);">
                            <span class="hindi-text">\${article.genre || 'अन्य'}</span>
                            <span>\${formatRelativeTime(article.published_at)}</span>
                        </div>
                    </div>
                \`).join('');
                
                // Fetch breaking news
                try {
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand/breaking\`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success && data.breaking_news.length > 0) {
                            breakingNewsText.textContent = data.breaking_news[0].title;
                        }
                    }
                } catch (error) {
                    console.log('Could not fetch breaking news:', error);
                }
            }

            // Show notification
            function showNotification(message, type = 'info') {
                const notification = document.createElement('div');
                notification.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 1rem 1.5rem;
                    background: \${type === 'success' ? '#27ae60' : '#e74c3c'};
                    color: white;
                    border-radius: 8px;
                    box-shadow: var(--shadow);
                    z-index: 1000;
                    animation: slideIn 0.3s ease;
                    font-family: 'Noto Sans Devanagari', sans-serif;
                \`;
                
                notification.innerHTML = \`
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-\${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
                        <span>\${message}</span>
                    </div>
                \`;
                
                document.body.appendChild(notification);
                
                setTimeout(() => {
                    notification.style.animation = 'slideOut 0.3s ease';
                    setTimeout(() => notification.remove(), 300);
                }, 3000);
            }

            // Fetch district news
            async function fetchDistrictNews(district) {
                try {
                    const response = await fetch(\`\${API_BASE_URL}/api/uttarakhand/districts/\${district}\`);
                    if (response.ok) {
                        const data = await response.json();
                        if (data.success) {
                            allNews = data.data;
                            filterNews();
                            showNotification(\`\${district} समाचार लोड किया गया\`, 'success');
                        }
                    }
                } catch (error) {
                    showNotification('जिला समाचार लोड करने में त्रुटि', 'error');
                }
            }

            // Initialize page
            async function initPage() {
                // Fetch initial news
                await fetchUttarakhandNews();
                
                // Set up auto-refresh
                setInterval(fetchUttarakhandNews, UPDATE_INTERVAL);
                
                // Update time counter every minute
                setInterval(() => {
                    const mins = Math.floor((new Date() - lastUpdateTime) / 60000);
                    updatedTime.textContent = mins;
                }, 60000);
            }

            // Event Listeners
            refreshBtn.addEventListener('click', fetchUttarakhandNews);

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentFilter = btn.dataset.filter;
                    filterNews();
                });
            });

            // District tag click handler
            document.querySelectorAll('.district-tag').forEach(tag => {
                tag.addEventListener('click', function() {
                    const district = this.dataset.district;
                    fetchDistrictNews(district);
                });
            });

            // Back to top button
            window.addEventListener('scroll', () => {
                backToTop.classList.toggle('visible', window.scrollY > 300);
            });

            backToTop.addEventListener('click', (e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            // Add CSS for animations
            const style = document.createElement('style');
            style.textContent = \`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
                
                .news-card {
                    animation: fadeIn 0.5s ease;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            \`;
            document.head.appendChild(style);

            // Initialize the page
            document.addEventListener('DOMContentLoaded', initPage);
        </script>
    </body>
    </html>
  `);
});

/* -------------------- Error Handling -------------------- */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message
  });
});

/* -------------------- Start Server -------------------- */
const PORT = process.env.PORT || 10000;

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
  🚀 SERVER STARTED SUCCESSFULLY!
  ============================================
  Port: ${PORT}
  URL: https://rt-india.onrender.com
  
  🔥 LATEST NEWS CONFIGURATION:
  - Max concurrent tasks: ${MAX_CONCURRENT_TASKS}
  - Poll interval: ${POLL_MINUTES} minutes (FAST!)
  - Focus: LATEST NEWS ONLY (last 24 hours)
  - Priority: Uttarakhand → National → International
  - Retention: 3 days cleanup
  - Features: 300+ words, video extraction
  
  📰 NEWS SOURCES (LATEST FIRST):
  1. News18 Uttarakhand (RSS - Latest)
  2. GNews Uttarakhand (Hindi - Latest)
  3. India National (NewsAPI - Latest 24h)
  4. India Hindi (GNews - Latest)
  5. International (GNews - Latest)
  6. World News (NewsAPI - Latest 24h)
  
  🏔️ UTTARAKHAND NEWS PAGE:
  - URL: /uttarakhand
  - API: /api/uttarakhand-news
  - Stats: /api/uttarakhand/stats
  - Districts: /api/uttarakhand/districts/:district
  - Breaking: /api/uttarakhand/breaking
  
  ⚡ SYSTEM FEATURES:
  - Uttarakhand-specific news filtering
  - District-wise organization
  - Hindi language support
  - Real-time updates every ${POLL_MINUTES} minutes
  - Breaking news ticker
  
  📊 EXPECTED OUTPUT:
  - Only Uttarakhand news
  - 300+ word detailed articles in Hindi
  - Video extraction when available
  - Fresh content with every run
  
  🚀 Ready to deliver LATEST Hindi news from Uttarakhand!
  `);
});