const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    const ua = req.get('User-Agent') || '';
    if (/curl|wget|python|scrapy|fetch|node|bot|crawler/i.test(ua) && !ua.includes('Mozilla')) {
        return res.status(403).send('Akses ditolak');
    }
    res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff', 'X-Powered-By': 'Zeon Komik', 'X-Creator': 'Ryzen Official' });
    next();
});

const BASE = 'https://komikindo.ch';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36';

const cache = {};
const CACHE_TIME = 600000;
function getCache(k) { if (cache[k] && Date.now() - cache[k].time < CACHE_TIME) return cache[k].data; return null; }
function setCache(k, d) { cache[k] = { time: Date.now(), data: d }; }

function fixUrl(u) {
    if (!u) return '';
    if (u.startsWith('http')) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return BASE + u;
    return BASE + '/' + u;
}

function cleanText(t) {
    return (t || '').replace(/komikindo|komik indo|baca komik|download komik/gi, '').replace(/\s+/g, ' ').trim();
}

app.get('/api/home', async (req, res) => {
    const c = getCache('home'); if (c) return res.json(c);
    try {
        const { data } = await axios.get(BASE, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const list = [];
        $('.listupd .animepost, .serieslist .animepost, .listupd a, .serieslist a').each((i, el) => {
            const link = $(el).is('a') ? $(el) : $(el).find('a').first();
            const href = link.attr('href');
            const img = $(el).find('img').first();
            const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy') || img.attr('data-cfsrc') || '';
            const title = cleanText(img.attr('title') || img.attr('alt') || link.attr('title') || link.text());
            if (href && title && href.includes('/komik/') && title.length > 2) {
                const u = href.startsWith('http') ? href : BASE + href;
                if (!list.find(k => k.url === u)) list.push({ title, url: u, thumbnail: fixUrl(src) });
            }
        });
        if (list.length === 0) {
            $('a[href*="/komik/"]').each((i, el) => {
                const href = $(el).attr('href');
                const title = cleanText($(el).attr('title') || $(el).find('img').attr('title') || $(el).text());
                const img = $(el).find('img[itemprop="image"], img').first();
                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy') || '';
                if (href && title && href.includes('/komik/') && title.length > 2) {
                    const u = href.startsWith('http') ? href : BASE + href;
                    if (!list.find(k => k.url === u)) list.push({ title, url: u, thumbnail: fixUrl(src) });
                }
            });
        }
        const r = { success: true, data: list.slice(0, 50) };
        setCache('home', r); res.json(r);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/detail', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.json({ success: false });
    const ck = 'detail_' + encodeURIComponent(url);
    const c = getCache(ck); if (c) return res.json(c);
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const title = cleanText($('.entry-title').text() || $('h1').first().text() || 'Unknown');
        const thumb = $('.thumb img[itemprop="image"], .thumb img, img.wp-post-image, img[itemprop="image"], .animepost img').first().attr('src') || '';
        const synopsis = cleanText(($('.entry-content, .sinopsis, .desc').first().text() || '').substring(0, 500));
        const chapters = [];
        $('.eps_lst a, .listeps a, a[href*="/ch/"], a[href*="/chapter/"]').each((i, el) => {
            const t = cleanText($(el).text());
            const u = $(el).attr('href');
            if (t && u && t.length > 2) {
                const fullUrl = u.startsWith('http') ? u : BASE + u;
                if (!chapters.find(c => c.url === fullUrl)) chapters.push({ title: t, url: fullUrl, date: '' });
            }
        });
        const r = { success: true, data: { title, thumbnail: fixUrl(thumb), synopsis, chapters: chapters.slice(0, 500) } };
        setCache(ck, r); res.json(r);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/read', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.json({ success: false });
    const ck = 'read_' + encodeURIComponent(url);
    const c = getCache(ck); if (c) return res.json(c);
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const imgs = [];
        $('*').each((i, el) => {
            const txt = $(el).text();
            if (/komikindo|komik indo/i.test(txt) && !$(el).is('img') && !$(el).is('input') && !$(el).is('a')) $(el).remove();
        });
        $('img').each((i, el) => {
            const s = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy') || $(el).attr('data-cfsrc') || '';
            const w = parseInt($(el).attr('width') || '0');
            if (s && /\.(jpg|png|webp|jpeg)/i.test(s) && !/avatar|icon|logo/i.test(s) && w !== 50 && w !== 100) imgs.push(fixUrl(s));
        });
        const r = { success: true, data: { title: cleanText($('h1').first().text() || 'Chapter'), images: [...new Set(imgs)] } };
        setCache(ck, r); res.json(r);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ success: false });
    const query = q.toLowerCase();
    try {
        const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const list = [];
        $('a[href*="/komik/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = ($(el).attr('title') || $(el).text()).toLowerCase();
            if (href && title && title.includes(query)) list.push({ title: cleanText($(el).attr('title') || $(el).text()), url: href.startsWith('http') ? href : BASE + href });
        });
        res.json({ success: true, data: [...new Map(list.map(r => [r.url, r])).values()].slice(0, 30) });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/genres', async (req, res) => {
    const c = getCache('genres'); if (c) return res.json(c);
    try {
        const { data } = await axios.get(BASE + '/daftar-komik/', { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const genres = [];
        $('a[href*="/genre/"], a[href*="/genres/"]').each((i, el) => {
            const t = cleanText($(el).text());
            const u = $(el).attr('href');
            if (t && u && t.length > 2) genres.push({ name: t, url: u.startsWith('http') ? u : BASE + u });
        });
        const r = { success: true, data: [...new Map(genres.map(g => [g.name, g])).values()] };
        setCache('genres', r); res.json(r);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/genre', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.json({ success: false });
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const list = [];
        $('a[href*="/komik/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = cleanText($(el).attr('title') || $(el).find('img').attr('title') || $(el).text());
            if (href && title && href.includes('/komik/') && title.length > 2) list.push({ title, url: href.startsWith('http') ? href : BASE + href });
        });
        res.json({ success: true, data: [...new Map(list.map(r => [r.url, r])).values()].slice(0, 50) });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

const bookmarks = {};
app.get('/api/bookmarks', (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.json({ success: false });
    res.json({ success: true, data: bookmarks[uid] || [] });
});
app.post('/api/bookmarks/add', (req, res) => {
    const { uid, url, title } = req.body;
    if (!uid || !url) return res.json({ success: false });
    if (!bookmarks[uid]) bookmarks[uid] = [];
    if (!bookmarks[uid].find(b => b.url === url)) bookmarks[uid].push({ url, title, date: new Date().toISOString() });
    res.json({ success: true });
});
app.post('/api/bookmarks/remove', (req, res) => {
    const { uid, url } = req.body;
    if (!uid) return res.json({ success: false });
    if (bookmarks[uid]) bookmarks[uid] = bookmarks[uid].filter(b => b.url !== url);
    res.json({ success: true });
});

const comments = {};
const reacts = {};
const reactCounts = {};
app.get('/api/comments', (req, res) => {
    const { url } = req.query;
    res.json({ success: true, data: comments[url] || [], reacts: reactCounts[url] || { like: 0, love: 0, fire: 0 } });
});
app.post('/api/comments/add', (req, res) => {
    const { url, uid, name, avatar, text } = req.body;
    if (!url || !uid || !text) return res.json({ success: false });
    if (!comments[url]) comments[url] = [];
    comments[url].push({ uid, name, avatar, text: text.substring(0, 500), date: new Date().toISOString() });
    res.json({ success: true });
});
app.post('/api/react', (req, res) => {
    const { url, uid, type } = req.body;
    if (!url || !uid || !type) return res.json({ success: false });
    if (!reacts[url]) reacts[url] = {};
    if (!reactCounts[url]) reactCounts[url] = { like: 0, love: 0, fire: 0 };
    const prev = reacts[url][uid];
    if (prev) reactCounts[url][prev] = Math.max(0, (reactCounts[url][prev] || 1) - 1);
    if (prev === type) { delete reacts[url][uid]; }
    else { reacts[url][uid] = type; reactCounts[url][type] = (reactCounts[url][type] || 0) + 1; }
    res.json({ success: true, reacts: reactCounts[url], myReact: reacts[url][uid] || null });
});

module.exports = app;