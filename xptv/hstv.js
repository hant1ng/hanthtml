async function getLocalInfo() {
    return jsonify({
        ver: 1,
        name: '🕶️HSTV',
        api: 'csp_hstv',
    })
}

const cheerio = createCheerio()

const SITE = 'https://hstv.life'
const HOME = SITE + '/'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'

const appConfig = {
    ver: 1,
    title: '🕶️HSTV',
    site: HOME,
    tabs: [
        { name: '首页', ui: 1, ext: { url: HOME } },
    ],
}

function normalizeUrl(url, base) {
    if (!url) return ''

    let value = String(url)
        .replace(/&amp;/g, '&')
        .replace(/\\\//g, '/')
        .trim()

    if (!value) return ''
    if (/^(?:javascript:|mailto:|tel:|#)/i.test(value)) return ''

    try {
        if (/^https?:\/\//i.test(value)) return value
        if (value.startsWith('//')) return 'https:' + value

        const root = base || SITE
        if (value.startsWith('/')) return SITE + value

        const slash = root.lastIndexOf('/')
        const dir = slash >= 8 ? root.slice(0, slash + 1) : SITE + '/'
        return dir + value.replace(/^\.\//, '')
    } catch (e) {
        return ''
    }
}

function sameSite(url) {
    return /^https?:\/\/hstv\.life(?:\/|$)/i.test(String(url || ''))
}

function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
}

function firstNonEmpty(values) {
    for (let i = 0; i < values.length; i++) {
        const value = cleanText(values[i])
        if (value) return value
    }
    return ''
}

function baseHeaders(referer, accept) {
    return {
        'User-Agent': UA,
        'Referer': referer || HOME,
        'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    }
}

async function requestPage(url, referer) {
    return await $fetch.get(url, {
        headers: baseHeaders(referer || HOME),
    })
}

function isChallengePage(data) {
    const html = String(data || '')
    return /cf-chl-|challenge-platform|Just a moment|Attention Required|Checking your browser|验证码|人机验证/i.test(html)
}

function isBadNavText(text) {
    return /^(首页|home|登录|登入|注册|註冊|会员|會員|我的|个人|個人|关于|關於|联系|聯繫|下载|下載|app|历史|歷史|收藏|反馈|反饋)$/i.test(cleanText(text))
}

function isLikelyCategory(href, text) {
    if (!href || !sameSite(href)) return false
    if (isBadNavText(text)) return false

    const path = href.replace(SITE, '')
    if (!path || path === '/') return false
    if (/\/(?:login|register|user|member|profile|history|favorite|about|contact)(?:\/|\?|$)/i.test(path)) return false

    return /\/(?:category|categories|channel|channels|type|types|tag|tags|class|list|videos?|vod)(?:\/|\?|$)/i.test(path) ||
        /[?&](?:category|cate|type|class|channel|tag)=/i.test(path)
}

async function discoverTabs() {
    const tabs = [{ name: '首页', ui: 1, ext: { url: HOME } }]

    try {
        const { data } = await requestPage(HOME)
        if (isChallengePage(data)) return tabs

        const $ = cheerio.load(String(data || ''))
        const seen = {}
        seen[HOME] = true

        $('nav a[href], header a[href], .nav a[href], .navbar a[href], .menu a[href], .menu-item a[href]').each((_, el) => {
            if (tabs.length >= 12) return

            const a = $(el)
            const text = cleanText(a.text())
            const href = normalizeUrl(a.attr('href'), HOME)

            if (!text || text.length > 14) return
            if (!isLikelyCategory(href, text)) return
            if (seen[href]) return

            seen[href] = true
            tabs.push({
                name: text,
                ui: 1,
                ext: { url: href },
            })
        })
    } catch (e) {
        $print('HSTV discoverTabs error: ' + e)
    }

    return tabs
}

function isLikelyVideoHref(href) {
    const value = String(href || '')
    if (!value || !sameSite(value)) return false

    if (/\/(?:login|register|user|member|profile|history|favorite|about|contact|category|categories|channel|channels|tag|tags)(?:\/|\?|$)/i.test(value)) {
        return false
    }

    return /\/(?:video|videos|watch|play|vod|detail|movie|film|v)(?:\/|\?|$)/i.test(value) ||
        /[?&](?:id|vid|video|vod|play)=/i.test(value)
}

function cardFromAnchor($, a, baseUrl) {
    const href = normalizeUrl(a.attr('href'), baseUrl)
    if (!href || !sameSite(href)) return null

    let box = a.closest('article, li, [class*="video"], [class*="vod"], [class*="card"], [class*="item"]')
    if (!box || !box.length) box = a.parent()

    let img = a.find('img').first()
    if (!img.length) img = box.find('img').first()

    const hasImage = img && img.length > 0
    const videoHref = isLikelyVideoHref(href)

    if (!videoHref && !hasImage) return null

    let title = firstNonEmpty([
        a.attr('title'),
        a.attr('aria-label'),
        img.attr('alt'),
        box.find('[class*="title"]').first().text(),
        box.find('h2,h3,h4').first().text(),
        a.text(),
    ])

    if (!title || title.length > 160) return null

    const cover = normalizeUrl(firstNonEmpty([
        img.attr('data-src'),
        img.attr('data-original'),
        img.attr('data-lazy-src'),
        img.attr('data-cover'),
        img.attr('src'),
    ]), baseUrl)

    const remark = firstNonEmpty([
        box.find('[class*="duration"]').first().text(),
        box.find('[class*="time"]').first().text(),
        box.find('[class*="remark"]').first().text(),
        box.find('[class*="meta"]').first().text(),
    ])

    return {
        vod_id: String(href),
        vod_name: title,
        vod_pic: cover,
        vod_remarks: remark,
        ext: {
            url: href,
        },
    }
}

function parseCards(data, baseUrl) {
    const html = String(data || '')
    const $ = cheerio.load(html)
    const list = []
    const seen = {}

    const selectors = [
        'article a[href]',
        '[class*="video"] a[href]',
        '[class*="vod"] a[href]',
        '[class*="card"] a[href]',
        '[class*="item"] a[href]',
        'main a[href]',
    ]

    $(selectors.join(',')).each((_, el) => {
        const card = cardFromAnchor($, $(el), baseUrl)
        if (!card || seen[card.vod_id]) return

        seen[card.vod_id] = true
        list.push(card)
    })

    // Strict fallback: image links only. This avoids turning navigation links into videos.
    if (!list.length) {
        $('a[href]').each((_, el) => {
            const a = $(el)
            if (!a.find('img').length) return

            const card = cardFromAnchor($, a, baseUrl)
            if (!card || seen[card.vod_id]) return

            seen[card.vod_id] = true
            list.push(card)
        })
    }

    return list
}

function withPage(url, page) {
    page = Number(page || 1)
    if (page <= 1) return url

    if (/[?&]page=\d+/i.test(url)) {
        return url.replace(/([?&]page=)\d+/i, '$1' + page)
    }

    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + page
}

function addMedia(out, url, referer) {
    url = normalizeUrl(url, referer)
    if (!url || !/^https?:\/\//i.test(url)) return

    // Ignore common image/subtitle assets.
    if (/\.(?:jpg|jpeg|png|gif|webp|vtt|srt)(?:\?|$)/i.test(url)) return
    if (!/\.(?:m3u8|mp4|m4v|mov|webm)(?:\?|$)/i.test(url) && !/[?&](?:m3u8|video|stream|play)=/i.test(url)) return

    for (let i = 0; i < out.length; i++) {
        if (out[i].url === url) return
    }

    out.push({
        url: url,
        type: /\.m3u8(?:\?|$)/i.test(url) ? 'm3u8' : 'mp4',
        referer: referer,
    })
}

function extractMedia(data, pageUrl) {
    const html = String(data || '')
    const $ = cheerio.load(html)
    const out = []

    $('video[src], video source[src], source[src]').each((_, el) => {
        addMedia(out, $(el).attr('src'), pageUrl)
    })

    const metaSelectors = [
        'meta[property="og:video"]',
        'meta[property="og:video:url"]',
        'meta[name="twitter:player:stream"]',
    ]

    $(metaSelectors.join(',')).each((_, el) => {
        addMedia(out, $(el).attr('content'), pageUrl)
    })

    $('[data-video], [data-src], [data-url], [data-file]').each((_, el) => {
        const node = $(el)
        addMedia(out, node.attr('data-video'), pageUrl)
        addMedia(out, node.attr('data-src'), pageUrl)
        addMedia(out, node.attr('data-url'), pageUrl)
        addMedia(out, node.attr('data-file'), pageUrl)
    })

    const normalized = html
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&')

    const directRe = /https?:\/\/[^"'<>\s\\]+?\.(?:m3u8|mp4|m4v|mov|webm)(?:\?[^"'<>\s\\]*)?/gi
    let m

    while ((m = directRe.exec(normalized)) !== null) {
        addMedia(out, m[0], pageUrl)
    }

    const keyRe = /["'](?:videoUrl|playUrl|streamUrl|file|src|url)["']\s*[:=]\s*["']([^"']+)["']/gi
    while ((m = keyRe.exec(normalized)) !== null) {
        addMedia(out, m[1], pageUrl)
    }

    return out
}

function extractIframes(data, pageUrl) {
    const $ = cheerio.load(String(data || ''))
    const result = []
    const seen = {}

    $('iframe[src]').each((_, el) => {
        const url = normalizeUrl($(el).attr('src'), pageUrl)
        if (!url || !/^https?:\/\//i.test(url) || seen[url]) return
        seen[url] = true
        result.push(url)
    })

    return result.slice(0, 4)
}

async function resolveMedia(pageUrl) {
    const result = []

    const { data } = await requestPage(pageUrl, HOME)
    let found = extractMedia(data, pageUrl)

    for (let i = 0; i < found.length; i++) result.push(found[i])
    if (result.length) return result

    const iframes = extractIframes(data, pageUrl)

    for (let i = 0; i < iframes.length; i++) {
        const iframeUrl = iframes[i]

        try {
            const { data: iframeData } = await requestPage(iframeUrl, pageUrl)
            found = extractMedia(iframeData, iframeUrl)

            for (let j = 0; j < found.length; j++) {
                let duplicate = false
                for (let k = 0; k < result.length; k++) {
                    if (result[k].url === found[j].url) duplicate = true
                }
                if (!duplicate) result.push(found[j])
            }
        } catch (e) {
            $print('HSTV iframe error: ' + e)
        }
    }

    return result
}

function findSearchForm(data) {
    const $ = cheerio.load(String(data || ''))
    let found = null

    $('form').each((_, el) => {
        if (found) return

        const form = $(el)
        const input = form.find('input[name]').filter((_, inputEl) => {
            const name = String($(inputEl).attr('name') || '')
            const type = String($(inputEl).attr('type') || 'text')
            return /^(?:q|s|wd|keyword|keywords|search|query|key)$/i.test(name) &&
                /^(?:text|search|)$/i.test(type)
        }).first()

        if (!input.length) return

        found = {
            action: normalizeUrl(form.attr('action') || HOME, HOME),
            method: String(form.attr('method') || 'get').toLowerCase(),
            name: String(input.attr('name') || 'q'),
        }
    })

    return found
}

async function runSearch(text, page) {
    let homeData = ''

    try {
        const res = await requestPage(HOME)
        homeData = res.data
        const form = findSearchForm(homeData)

        if (form) {
            if (form.method === 'post') {
                const body = form.name + '=' + encodeURIComponent(text) + '&page=' + page
                const { data } = await $fetch.post(form.action, body, {
                    headers: {
                        'User-Agent': UA,
                        'Referer': HOME,
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    },
                })

                const list = parseCards(data, form.action)
                if (list.length) return list
            } else {
                const url = form.action +
                    (form.action.indexOf('?') >= 0 ? '&' : '?') +
                    encodeURIComponent(form.name) + '=' + encodeURIComponent(text) +
                    '&page=' + page

                const { data } = await requestPage(url, HOME)
                const list = parseCards(data, url)
                if (list.length) return list
            }
        }
    } catch (e) {
        $print('HSTV search form error: ' + e)
    }

    const candidates = [
        SITE + '/search?q=' + encodeURIComponent(text) + '&page=' + page,
        SITE + '/search?keyword=' + encodeURIComponent(text) + '&page=' + page,
        SITE + '/?s=' + encodeURIComponent(text) + '&page=' + page,
        SITE + '/search/' + encodeURIComponent(text) + '?page=' + page,
    ]

    for (let i = 0; i < candidates.length; i++) {
        try {
            const { data } = await requestPage(candidates[i], HOME)
            const list = parseCards(data, candidates[i])
            if (list.length) return list
        } catch (e) {}
    }

    return []
}

async function getConfig() {
    const config = {
        ver: appConfig.ver,
        title: appConfig.title,
        site: appConfig.site,
        tabs: await discoverTabs(),
    }

    return jsonify(config)
}

async function getCards(ext) {
    try {
        ext = argsify(ext)
        const page = Number(ext.page || 1)
        const base = ext.url || HOME

        let url = withPage(base, page)
        let { data } = await requestPage(url, HOME)
        let list = parseCards(data, url)

        // A number of sites use /page/<n> instead of ?page=<n>.
        if (!list.length && page > 1) {
            const alternate = base.replace(/\/$/, '') + '/page/' + page
            ;({ data } = await requestPage(alternate, HOME))
            list = parseCards(data, alternate)
            url = alternate
        }

        if (!list.length && isChallengePage(data)) {
            $utils.toastError('HSTV 当前返回验证页面')
        }

        $print('HSTV cards=' + list.length + ' url=' + url)

        return jsonify({
            list: list,
            page: page,
        })
    } catch (e) {
        $print('HSTV getCards error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getTracks(ext) {
    try {
        ext = argsify(ext)
        const url = String(ext.url || '').trim()
        if (!url) return jsonify({ list: [] })

        return jsonify({
            list: [{
                title: '播放',
                tracks: [{
                    name: '播放',
                    pan: '',
                    ext: {
                        url: url,
                    },
                }],
            }],
        })
    } catch (e) {
        $print('HSTV getTracks error: ' + e)
        return jsonify({ list: [] })
    }
}

async function getPlayinfo(ext) {
    try {
        ext = argsify(ext)
        const pageUrl = String(ext.url || '').trim()
        if (!pageUrl) return jsonify({ urls: [], headers: [] })

        const sources = await resolveMedia(pageUrl)

        if (!sources.length) {
            $utils.toastError('HSTV 播放地址解析失败')
            return jsonify({ urls: [], headers: [] })
        }

        return jsonify({
            urls: sources.map(item => item.url),
            headers: sources.map(item => ({
                'User-Agent': UA,
                'Referer': item.referer || pageUrl,
            })),
        })
    } catch (e) {
        $print('HSTV getPlayinfo error: ' + e)
        $utils.toastError('HSTV 播放解析失败')
        return jsonify({ urls: [], headers: [] })
    }
}

async function search(ext) {
    try {
        ext = argsify(ext)
        const text = cleanText(ext.text)
        const page = Number(ext.page || 1)

        if (!text) return jsonify({ list: [], page: page })

        const list = await runSearch(text, page)

        return jsonify({
            list: list,
            page: page,
        })
    } catch (e) {
        $print('HSTV search error: ' + e)
        return jsonify({ list: [] })
    }
}
