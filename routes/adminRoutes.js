// routes/adminRoutes.js
const express = require('express');

/**
 * Admin routes factory
 * @param {Object} deps
 * @param {string} deps.SUPABASE_URL - e.g. process.env.SUPABASE_URL
 * @param {import('@supabase/supabase-js').SupabaseClient} deps.supabaseAdmin - supabase client instantiated with service role key
 * @param {string[]} deps.ADMIN_EMAILS - array of allowed admin emails (lowercase)
 * @param {string} deps.SUPABASE_ANON_KEY - supabase anon public key (used when validating tokens via auth/v1/user)
 */
module.exports = function adminRoutesFactory({ SUPABASE_URL, supabaseAdmin, ADMIN_EMAILS = [], SUPABASE_ANON_KEY = '' }) {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL required for adminRoutesFactory');
  if (!supabaseAdmin) throw new Error('supabaseAdmin client required for adminRoutesFactory');

  const router = express.Router();

  // small helper - verify token belongs to an allowed admin email
  async function requireAdmin(req, res, next) {
    try {
      const authHeader = req.headers.authorization || '';
      const token = (authHeader.split(' ')[1] || '').trim();
      if (!token) return res.status(401).json({ error: 'Missing Authorization token' });

      // Supabase v1 user endpoint works with Bearer token.
      // Include anon key for reliability.
      const headers = {
        Authorization: `Bearer ${token}`
      };
      if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;

      const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'GET',
        headers
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        // return details but keep it concise
        console.warn('requireAdmin: /auth/v1/user returned', r.status, txt || '(no body)');
        return res.status(401).json({ error: 'Invalid token', details: txt || `status ${r.status}` });
      }

      const user = await r.json().catch(() => null);
      if (!user || !user.email) {
        console.warn('requireAdmin: user endpoint returned no email', user);
        return res.status(401).json({ error: 'Unable to fetch user info' });
      }

      const email = String(user.email || '').toLowerCase();
      console.info('requireAdmin: authenticated user email ->', email);

      if (!ADMIN_EMAILS.includes(email)) {
        console.warn('requireAdmin: forbidden - email not in ADMIN_EMAILS:', email);
        return res.status(403).json({ error: 'Forbidden - not an admin' });
      }

      // attach minimal user info
      req.adminUser = { id: user.id, email };
      next();
    } catch (err) {
      console.error('requireAdmin error', err && err.message ? err.message : err);
      return res.status(500).json({ error: 'Auth check failed' });
    }
  }

  /* --------------------
     GET /admin/articles
     query: q, limit, offset, include_deleted
  -------------------- */
  router.get('/articles', requireAdmin, async (req, res) => {
    try {
      const q = (req.query.q || '').trim();
      const limit = Math.min(500, parseInt(req.query.limit || '200', 10));
      const offset = parseInt(req.query.offset || '0', 10);
      const includeDeleted = (req.query.include_deleted || 'false').toLowerCase() === 'true';

      let query = supabaseAdmin
        .from('ai_news')
        .select('*', { count: 'exact' })
        .order('published_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }

      if (q) {
        const escaped = q.replace(/%/g, '\\%').replace(/,/g, ' ');
        query = query.or(
          `title.ilike.%${escaped}%,short_desc.ilike.%${escaped}%,region.ilike.%${escaped}%,genre.ilike.%${escaped}%,slug.ilike.%${escaped}%`
        );
      }

      const { data, error, count } = await query;
      if (error) {
        console.error('GET /admin/articles supabase error:', error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ data, count });
    } catch (err) {
      console.error('GET /admin/articles error', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /* --------------------
     POST /admin/articles  -> create new article
  -------------------- */
  router.post('/articles', requireAdmin, async (req, res) => {
    try {
      const payload = req.body || {};
      const record = {
        title: payload.title || 'Untitled',
        slug: payload.slug || null,
        source_url: payload.source_url || '',
        ai_content: payload.ai_content || '',
        short_desc: payload.short_desc || (payload.ai_content || '').slice(0, 250),
        image_url: payload.image_url || null,
        published_at: payload.published_at || new Date().toISOString(),
        region: payload.region || null,
        genre: payload.genre || null,
        meta: payload.meta || {}
      };

      const { data, error } = await supabaseAdmin.from('ai_news').insert([record]).select().single();
      if (error) {
        console.error('POST /admin/articles supabase error:', error);
        return res.status(500).json({ error: error.message });
      }

      try {
        await supabaseAdmin.from('admin_audit').insert([{
          admin_email: req.adminUser.email,
          action: 'create',
          article_id: data.id,
          payload: record,
          created_at: new Date().toISOString()
        }]);
      } catch (e) {
        // ignore audit errors
      }

      res.status(201).json({ data });
    } catch (err) {
      console.error('POST /admin/articles error', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /* --------------------
     PUT /admin/articles/:id -> update full record
  -------------------- */
  router.put('/articles/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body || {};
      delete payload.id;

      const { data, error } = await supabaseAdmin.from('ai_news').update(payload).eq('id', id).select().single();
      if (error) {
        console.error('PUT /admin/articles/:id supabase error:', error);
        return res.status(500).json({ error: error.message });
      }

      try {
        await supabaseAdmin.from('admin_audit').insert([{
          admin_email: req.adminUser.email,
          action: 'update',
          article_id: id,
          payload,
          created_at: new Date().toISOString()
        }]);
      } catch (e) {}

      res.json({ data });
    } catch (err) {
      console.error('PUT /admin/articles/:id error', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /* --------------------
     DELETE /admin/articles/:id -> hard delete (or soft if requested)
  -------------------- */
  router.delete('/articles/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const soft = (req.query.soft || 'false').toLowerCase() === 'true';

      if (soft) {
        const { data, error } = await supabaseAdmin.from('ai_news').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single();
        if (error) {
          console.error('DELETE soft supabase error:', error);
          return res.status(500).json({ error: error.message });
        }

        try {
          await supabaseAdmin.from('admin_audit').insert([{
            admin_email: req.adminUser.email,
            action: 'soft_delete',
            article_id: id,
            payload: null,
            created_at: new Date().toISOString()
          }]);
        } catch (e) {}

        return res.json({ data, message: 'soft deleted' });
      } else {
        const { data, error } = await supabaseAdmin.from('ai_news').delete().eq('id', id).select().single();
        if (error) {
          console.error('DELETE hard supabase error:', error);
          return res.status(500).json({ error: error.message });
        }

        try {
          await supabaseAdmin.from('admin_audit').insert([{
            admin_email: req.adminUser.email,
            action: 'delete',
            article_id: id,
            payload: null,
            created_at: new Date().toISOString()
          }]);
        } catch (e) {}

        return res.json({ data, message: 'deleted' });
      }
    } catch (err) {
      console.error('DELETE /admin/articles/:id error', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  /* --------------------
     GET /admin/article/:id -> single article
  -------------------- */
  router.get('/article/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('ai_news').select('*').eq('id', id).maybeSingle();
      if (error) {
        console.error('GET /admin/article/:id supabase error:', error);
        return res.status(500).json({ error: error.message });
      }
      if (!data) return res.status(404).json({ error: 'Article not found' });
      res.json({ data });
    } catch (err) {
      console.error('GET /admin/article/:id error', err && err.message ? err.message : err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
