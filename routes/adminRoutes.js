// routes/adminRoutes.js
const express = require('express');

module.exports = function adminRoutesFactory({ SUPABASE_URL, supabaseAdmin, ADMIN_EMAILS = [], SUPABASE_ANON_KEY = '' }) {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL required for adminRoutesFactory');
  if (!supabaseAdmin) throw new Error('supabaseAdmin client required for adminRoutesFactory');

  const router = express.Router();

  // Add CORS middleware for admin routes
  router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  // Debug middleware
  router.use((req, res, next) => {
    console.log(`[ADMIN] ${req.method} ${req.path}`, {
      auth: req.headers.authorization ? 'present' : 'missing',
      timestamp: new Date().toISOString()
    });
    next();
  });

  // Helper to verify admin token
  async function verifyAdminToken(token) {
    try {
      if (!token) {
        console.log('[ADMIN] No token provided');
        return null;
      }

      // Check if token is the anon key (shouldn't be used for admin)
      if (token === SUPABASE_ANON_KEY) {
        console.warn('[ADMIN] Token matches anon key - rejecting');
        return null;
      }

      // Verify token with Supabase
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY
        }
      });

      if (!response.ok) {
        console.log(`[ADMIN] Token verification failed: ${response.status}`);
        return null;
      }

      const user = await response.json();
      console.log(`[ADMIN] Verified user: ${user.email}`);
      
      // Check if user is in admin list
      const email = user.email.toLowerCase();
      if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(email)) {
        console.log(`[ADMIN] User ${email} not in admin list`);
        return null;
      }

      return user;
    } catch (error) {
      console.error('[ADMIN] Token verification error:', error.message);
      return null;
    }
  }

  // Middleware to require admin authentication
  async function requireAdmin(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '').trim();

      const user = await verifyAdminToken(token);
      
      if (!user) {
        console.log('[ADMIN] Authentication failed');
        return res.status(401).json({ 
          error: 'Authentication required',
          message: 'Invalid or missing authentication token'
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('[ADMIN] Auth middleware error:', error);
      res.status(500).json({ 
        error: 'Authentication error',
        message: error.message 
      });
    }
  }

  // GET /admin/articles - List articles with pagination
  router.get('/articles', requireAdmin, async (req, res) => {
    try {
      const { 
        q = '', 
        limit = '30', 
        offset = '0',
        include_deleted = 'false' 
      } = req.query;

      const parsedLimit = Math.min(parseInt(limit, 10) || 30, 100);
      const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
      const includeDeleted = include_deleted === 'true';

      console.log(`[ADMIN] Fetching articles: limit=${parsedLimit}, offset=${parsedOffset}, q=${q}`);

      let query = supabaseAdmin
        .from('ai_news')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply search if query exists
      if (q && q.trim()) {
        const searchTerm = `%${q.trim()}%`;
        query = query.or(`title.ilike.${searchTerm},short_desc.ilike.${searchTerm},region.ilike.${searchTerm},genre.ilike.${searchTerm}`);
      }

      // Exclude soft-deleted unless requested
      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }

      // Apply pagination
      const { data, error, count } = await query
        .range(parsedOffset, parsedOffset + parsedLimit - 1);

      if (error) {
        console.error('[ADMIN] Database error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          details: error.message 
        });
      }

      console.log(`[ADMIN] Retrieved ${data?.length || 0} articles, total: ${count || 0}`);

      res.json({
        success: true,
        data: data || [],
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: count || 0,
          hasMore: (count || 0) > (parsedOffset + parsedLimit)
        }
      });

    } catch (error) {
      console.error('[ADMIN] Articles list error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error',
        message: error.message 
      });
    }
  });

  // GET /admin/articles/:id - Get single article
  router.get('/articles/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`[ADMIN] Fetching article ${id}`);

      const { data, error } = await supabaseAdmin
        .from('ai_news')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('[ADMIN] Database error:', error);
        return res.status(500).json({ 
          error: 'Database error', 
          details: error.message 
        });
      }

      if (!data) {
        return res.status(404).json({ 
          success: false,
          error: 'Article not found' 
        });
      }

      res.json({
        success: true,
        data
      });

    } catch (error) {
      console.error('[ADMIN] Single article error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error',
        message: error.message 
      });
    }
  });

  // POST /admin/articles - Create new article
  router.post('/articles', requireAdmin, async (req, res) => {
    try {
      const payload = req.body;
      
      // Validate required fields
      if (!payload.title || !payload.title.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Title is required'
        });
      }

      // Generate slug if not provided
      if (!payload.slug) {
        const slug = payload.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        payload.slug = slug;
      }

      // Set default values
      const now = new Date().toISOString();
      const article = {
        title: payload.title.trim(),
        slug: payload.slug,
        source_url: payload.source_url || '',
        ai_content: payload.ai_content || '',
        short_desc: payload.short_desc || (payload.ai_content || '').substring(0, 200) + '...',
        image_url: payload.image_url || `https://picsum.photos/seed/${Date.now()}/1200/630`,
        published_at: payload.published_at || now,
        region: payload.region || 'india',
        genre: payload.genre || 'Other',
        created_at: now,
        updated_at: now,
        meta: {
          ...(payload.meta || {}),
          created_by: req.user.email,
          created_at: now,
          is_manual: true
        }
      };

      console.log(`[ADMIN] Creating article: ${article.title}`);

      const { data, error } = await supabaseAdmin
        .from('ai_news')
        .insert([article])
        .select()
        .single();

      if (error) {
        console.error('[ADMIN] Create error:', error);
        return res.status(500).json({ 
          success: false,
          error: 'Database error', 
          details: error.message 
        });
      }

      // Log to audit trail
      try {
        await supabaseAdmin.from('admin_audit').insert({
          admin_email: req.user.email,
          action: 'create',
          article_id: data.id,
          article_title: data.title,
          created_at: now
        });
      } catch (auditError) {
        console.warn('[ADMIN] Audit log error:', auditError.message);
      }

      res.status(201).json({
        success: true,
        message: 'Article created successfully',
        data
      });

    } catch (error) {
      console.error('[ADMIN] Create article error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error',
        message: error.message 
      });
    }
  });

  // PUT /admin/articles/:id - Update article
  router.put('/articles/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      
      console.log(`[ADMIN] Updating article ${id}`);

      // Remove fields that shouldn't be updated
      delete payload.id;
      delete payload.created_at;
      
      // Add update timestamp
      payload.updated_at = new Date().toISOString();
      
      // Update meta field
      if (payload.meta) {
        payload.meta = {
          ...payload.meta,
          updated_by: req.user.email,
          updated_at: payload.updated_at
        };
      }

      const { data, error } = await supabaseAdmin
        .from('ai_news')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[ADMIN] Update error:', error);
        return res.status(500).json({ 
          success: false,
          error: 'Database error', 
          details: error.message 
        });
      }

      if (!data) {
        return res.status(404).json({ 
          success: false,
          error: 'Article not found' 
        });
      }

      // Log to audit trail
      try {
        await supabaseAdmin.from('admin_audit').insert({
          admin_email: req.user.email,
          action: 'update',
          article_id: id,
          article_title: data.title,
          created_at: new Date().toISOString()
        });
      } catch (auditError) {
        console.warn('[ADMIN] Audit log error:', auditError.message);
      }

      res.json({
        success: true,
        message: 'Article updated successfully',
        data
      });

    } catch (error) {
      console.error('[ADMIN] Update article error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error',
        message: error.message 
      });
    }
  });

  // DELETE /admin/articles/:id - Delete article
  router.delete('/articles/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { soft = 'false' } = req.query;
      const isSoftDelete = soft.toLowerCase() === 'true';

      console.log(`[ADMIN] Deleting article ${id} (soft: ${isSoftDelete})`);

      let result;
      
      if (isSoftDelete) {
        // Soft delete - mark as deleted
        const { data, error } = await supabaseAdmin
          .from('ai_news')
          .update({ 
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        result = data;
      } else {
        // Hard delete - remove from database
        const { data, error } = await supabaseAdmin
          .from('ai_news')
          .delete()
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        result = data;
      }

      if (!result) {
        return res.status(404).json({ 
          success: false,
          error: 'Article not found' 
        });
      }

      // Log to audit trail
      try {
        await supabaseAdmin.from('admin_audit').insert({
          admin_email: req.user.email,
          action: isSoftDelete ? 'soft_delete' : 'hard_delete',
          article_id: id,
          article_title: result.title,
          created_at: new Date().toISOString()
        });
      } catch (auditError) {
        console.warn('[ADMIN] Audit log error:', auditError.message);
      }

      res.json({
        success: true,
        message: `Article ${isSoftDelete ? 'soft deleted' : 'deleted'} successfully`,
        data: result
      });

    } catch (error) {
      console.error('[ADMIN] Delete error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Database error',
        message: error.message 
      });
    }
  });

  // GET /admin/stats - Get admin statistics
  router.get('/stats', requireAdmin, async (req, res) => {
    try {
      const [
        { count: totalArticles },
        { count: deletedArticles },
        { data: recentArticles }
      ] = await Promise.all([
        supabaseAdmin
          .from('ai_news')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null),
        
        supabaseAdmin
          .from('ai_news')
          .select('*', { count: 'exact', head: true })
          .not('deleted_at', 'is', null),
        
        supabaseAdmin
          .from('ai_news')
          .select('genre, region, created_at')
          .order('created_at', { ascending: false })
          .limit(100)
      ]);

      // Calculate stats
      const stats = {
        total: totalArticles || 0,
        deleted: deletedArticles || 0,
        active: (totalArticles || 0) - (deletedArticles || 0),
        byGenre: {},
        byRegion: {},
        recent: recentArticles?.slice(0, 10) || []
      };

      // Count by genre and region
      recentArticles?.forEach(article => {
        stats.byGenre[article.genre] = (stats.byGenre[article.genre] || 0) + 1;
        stats.byRegion[article.region] = (stats.byRegion[article.region] || 0) + 1;
      });

      res.json({
        success: true,
        stats
      });

    } catch (error) {
      console.error('[ADMIN] Stats error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error',
        message: error.message 
      });
    }
  });

  // GET /admin/health - Health check
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      admin_emails_count: ADMIN_EMAILS.length,
      supabase_url: SUPABASE_URL ? 'configured' : 'missing'
    });
  });

  return router;
};