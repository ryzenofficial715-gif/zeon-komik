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

app.get('/api/home', async (req, res) => {
    const c = getCache('home'); if (c) return res.json(c);
    try {
        const { data } = await axios.get(BASE, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const list = [];
        $('a[href*="/komik/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).attr('title') || $(el).text().trim();
            const img = $(el).find('img').first();
            const src = img.attr('src') || img.attr('data-src') || '';
            if (href && title && href.includes('/komik/') && title.length > 2) {
                const u = href.startsWith('http') ? href : BASE + href;
                if (!list.find(k => k.url === u)) list.push({ title: title.trim(), url: u, thumbnail: src.startsWith('http') ? src : (src.startsWith('/') ? BASE + src : '') });
            }
        });
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
        const title = $('.entry-title').text().trim() || $('h1').first().text().trim() || 'Unknown';
        const thumbnail = ($('.thumb img').first().attr('src') || $('img').first().attr('src') || '').replace(/^\/\//, 'https://');
        const synopsis = ($('.entry-content, .sinopsis, .desc').first().text() || '').trim().substring(0, 500);
        const chapters = [];
        $('a[href*="/ch/"], a[href*="/chapter/"], .eplister a').each((i, el) => {
            const t = $(el).text().trim();
            const u = $(el).attr('href');
            if (t && u) chapters.push({ title: t, url: u.startsWith('http') ? u : BASE + u, date: '' });
        });
        const r = { success: true, data: { title, thumbnail, synopsis, chapters: [...new Map(chapters.map(c => [c.url, c])).values()].slice(0, 100) } };
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
        $('img').each((i, el) => {
            const s = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy') || '';
            if (s && (s.includes('.jpg') || s.includes('.png') || s.includes('.webp')) && !s.includes('avatar') && !s.includes('icon')) {
                imgs.push(s.startsWith('http') ? s : (s.startsWith('//') ? 'https:' + s : BASE + s));
            }
        });
        const r = { success: true, data: { title: $('h1').first().text().trim() || 'Chapter', images: [...new Set(imgs)] } };
        setCache(ck, r); res.json(r);
    } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ success: false });
    try {
        const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA }, timeout: 15000 });
        const $ = cheerio.load(data);
        const list = [];
        $('a[href*="/komik/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).attr('title') || $(el).text().trim();
            if (href && title && title.length > 2) list.push({ title: title.trim(), url: href.startsWith('http') ? href : BASE + href });
        });
        res.json({ success: true, data: [...new Map(list.map(r => [r.url, r])).values()].slice(0, 30) });
    } catch(e) { res.json({ success: false, error: e.message }); }
});

const bookmarks = {};
const comments = {};
const reacts = {};
const reactCounts = {};

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

app.get('/api/comments', (req, res) => {
    const { url } = req.query;
    res.json({ success: true, data: comments[url] || [], reacts: reactCounts[url] || { like: 0, love: 0, fire: 0 } });
});
app.post('/api/comments/add', (req, res) => {
    const { url, uid, name, avatar, text } = req.body;
    if (!url || !uid || !text) return res.json({ success: false });
    if (!comments[url]) comments[url] = [];
    comments[url].push({ uid, name, avatar, text: text.substring(0, 500), date: new Date().toISOString() });
    res.json({ success: true, data: comments[url] });
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