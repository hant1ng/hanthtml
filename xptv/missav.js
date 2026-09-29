async function getLocalInfo() {
    const info = {
        ver: 2,
        name: 'MissAV Fixed',
        api: 'csp_missav_fixed',
    }
    return jsonify(info)
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/604.1.14 (KHTML, like Gecko)'
const cheerio = createCheerio()

/*
可选配置：
{
    "enload": true
}
*/
let $config = argsify($config_str) || {}

const appConfig = {
    ver: 2,
    title: 'missav',
    site: 'https://missav.ai',
    tabs: [
        { name: '中文字幕', ui: 1, ext: { id: 'cn/chinese-subtitle' } },
        { name: '最近更新', ui: 1, ext: { id: 'cn/new' } },
        { name: '新作上市', ui: 1, ext: { id: 'cn/release' } },
        { name: '我的收藏', ui: 1, ext: { id: 'saved' } },
        { name: '无码流出', ui: 1, ext: { id: 'cn/uncensored-leak' } },
        { name: 'VR', ui: 1, ext: { id: 'cn/genres/VR' } },
        { name: '今日热门', ui: 1, ext: { id: 'cn/today-hot' } },
        { name: '本週热门', ui: 1, ext: { id: 'cn/weekly-hot' } },
        { name: '本月热门', ui: 1, ext: { id: 'cn/monthly-hot' } },
        { name: 'SIRO', ui: 1, ext: { id: 'cn/siro' } },
        { name: 'LUXU', ui: 1, ext: { id: 'cn/luxu' } },
        { name: 'GANA', ui: 1, ext: { id: 'cn/gana' } },
        { name: 'PRESTIGE PREMIUM', ui: 1, ext: { id: 'cn/maan' } },
        { name: 'S-CUTE', ui: 1, ext: { id: 'cn/scute' } },
        { name: 'ARA', ui: 1, ext: { id: 'cn/ara' } },
        { name: 'FC2', ui: 1, ext: { id: 'cn/fc2' } },
        { name: 'HEYZO', ui: 1, ext: { id: 'cn/heyzo' } },
        { name: '东京热', ui: 1, ext: { id: 'cn/tokyohot' } },
        { name: '一本道', ui: 1, ext: { id: 'cn/1pondo' } },
        { name: 'Caribbeancom', ui: 1, ext: { id: 'cn/caribbeancom' } },
        { name: 'Caribbeancompr', ui: 1, ext: { id: 'cn/caribbeancompr' } },
        { name: '10musume', ui: 1, ext: { id: 'cn/10musume' } },
        { name: 'pacopacomama', ui: 1, ext: { id: 'cn/pacopacomama' } },
        { name: 'Gachinco', ui: 1, ext: { id: 'cn/gachinco' } },
        { name: 'XXX-AV', ui: 1, ext: { id: 'cn/xxxav' } },
        { name: '人妻斩', ui: 1, ext: { id: 'cn/marriedslash' } },
        { name: '顽皮 4610', ui: 1, ext: { id: 'cn/naughty4610' } },
        { name: '顽皮 0930', ui: 1, ext: { id: 'cn/naughty0930' } },
        { name: '麻豆传媒', ui: 1, ext: { id: 'cn/madou' } },
        { name: 'TWAV AV', ui: 1, ext: { id: 'cn/twav' } },
        { name: 'Furuke AV', ui: 1, ext: { id: 'cn/furuke' } },
    ],
}

function isCloudflarePage(data) {
    if (!data || typeof data !== 'string') return false
    return data.includes('Just a moment...') ||
        data.includes('cf-browser-verification') ||
        data.includes('/cdn-cgi/challenge-platform/') ||
        data.includes('Verify you are human')
}

async function fetchPage(url, extraHeaders = {}) {
    let res = await $fetch.get(url, {
        headers: {
            'User-Agent': UA,
            ...extraHeaders,
        },
    })

    if (isCloudflarePage(res.data)) {
        $utils.openSafari(url, UA)
    }

    return res
}

function normalizeUrl(url) {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) return url
    if (url.startsWith('/')) return appConfig.site + url
    return appConfig.site + '/' + url
}

function parseCards(data) {
    const cards = []
    const $ = cheerio.load(data || '')
    const videos = $('.thumbnail')

    videos.each((_, e) => {
        const href = $(e).find('.text-secondary').attr('href') || $(e).find('a').first().attr('href') || ''
        const title = (
            $(e).find('.text-secondary').text() ||
            $(e).find('a[class*="text-secondary"]').text() ||
            $(e).find('img').attr('alt') ||
            ''
        ).trim().replace(/\s+/g, ' ')

        const cover =
            $(e).find('.w-full').attr('data-src') ||
            $(e).find('img').attr('data-src') ||
            $(e).find('img').attr('src') ||
            ''

        const remarks = $(e).find('.left-1').text().trim()
        const duration = $(e).find('.right-1').text().trim()

        if (!href || !title) return

        const fullUrl = normalizeUrl(href)

        cards.push({
            vod_id: fullUrl,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: remarks,
            vod_duration: duration,
            ext: {
                url: fullUrl,
            },
        })
    })

    return cards
}

async function getactress() {
    const url = appConfig.site + '/saved/actresses'
    const { data } = await fetchPage(url)
    const $ = cheerio.load(data || '')
    const actresss = $('.max-w-full.p-8.text-nord4.bg-nord1.rounded-lg')

    if (actresss.length === 0 && !isCloudflarePage(data)) {
        return []
    }

    const list = []

    try {
        actresss.find('.space-y-4').each((_, e) => {
            const rawHref = $(e).find('a:first').attr('href') || ''
            const name = $(e).find('h4').text().trim()
            if (!rawHref || !name) return

            let id = rawHref
            if (id.startsWith(appConfig.site + '/')) {
                id = id.slice((appConfig.site + '/').length)
            } else if (id.startsWith('/')) {
                id = id.slice(1)
            }

            list.push({
                name,
                ui: 1,
                ext: { id },
            })
        })
    } catch (e) {
        if ($utils.toastError) {
            $utils.toastError('没有找到收藏的女优')
        }
    }

    return list
}

async function getConfig() {
    const config = { ...appConfig, tabs: [...appConfig.tabs] }

    if ($config && $config.enload) {
        const list = await getactress()
        config.tabs = config.tabs.concat(list)
    }

    return jsonify(config)
}

async function getCards(ext) {
    ext = argsify(ext)
    let { page = 1, id, filters = {} } = ext

    if (id === 'saved' && (!$config || Object.keys($config).length === 0)) {
        return jsonify({ list: [] })
    }

    let url = appConfig.site + '/' + id + '?page=' + page

    if (filters.filters) {
        url += '&filters=' + encodeURIComponent(filters.filters)
    }

    if (filters.sort) {
        url += '&sort=' + encodeURIComponent(filters.sort)
    } else {
        url += '&sort=released_at'
    }

    if (filters.keyword) {
        url += '&keyword=' + encodeURIComponent(filters.keyword)
    }

    if (filters.actress) {
        url += '&actress=' + encodeURIComponent(filters.actress)
    }

    if (filters.tag) {
        url += '&tag=' + encodeURIComponent(filters.tag)
    }

    const { data } = await fetchPage(url)
    const cards = parseCards(data)

    return jsonify({
        list: cards,
        filter: [
            {
                key: 'filters',
                name: '过滤',
                init: '',
                value: [
                    { n: '所有', v: '' },
                    { n: '单人作品', v: 'individual' },
                    { n: '多人作品', v: 'multiple' },
                    { n: '中文字幕', v: 'chinese-subtitle' },
                ],
            },
            {
                key: 'sort',
                name: '排序',
                init: 'released_at',
                value: [
                    { n: '发行日期', v: 'released_at' },
                    { n: '最近更新', v: 'published_at' },
                    { n: '收藏数', v: 'saved' },
                    { n: '今日浏览数', v: 'today_views' },
                    { n: '本週浏览数', v: 'weekly_views' },
                    { n: '本月浏览数', v: 'monthly_views' },
                    { n: '总浏览数', v: 'views' },
                ],
            },
        ],
    })
}

async function getTracks(ext) {
    ext = argsify(ext)
    const url = normalizeUrl(ext.url)
    const m3u8Prefix = 'https://surrit.com/'
    const m3u8Suffix = '/playlist.m3u8'
    const tracks = []

    const { data } = await fetchPage(url)

    let match = data && data.match(/surrit\.com\\\/([^\\\/]+)\\\/seek\\\/_0\.jpg/)
    if (!match && data) {
        match = data.match(/surrit\.com\/([^\/]+)\/seek\/_0\.jpg/)
    }

    if (match && match[1]) {
        const uuid = match[1]
        const playlistUrl = m3u8Prefix + uuid + m3u8Suffix
        const { data: playlist } = await $fetch.get(playlistUrl, {
            headers: {
                'User-Agent': UA,
                'Referer': url,
            },
        })

        const lines = String(playlist || '').split('\n')
        const variants = lines.filter(line => line.includes('/video.m3u8'))

        variants.forEach(line => {
            const path = line.trim()
            if (!path) return
            const name = path.replace('/video.m3u8', '').replace(/^\//, '')
            tracks.unshift({
                name: name || '视频',
                pan: '',
                ext: {
                    url: path.startsWith('http') ? path : m3u8Prefix + uuid + '/' + path.replace(/^\//, ''),
                },
            })
        })

        tracks.push({
            name: '自动',
            pan: '',
            ext: {
                url: playlistUrl,
            },
        })
    }

    return jsonify({
        list: [
            {
                title: '默认分组',
                tracks,
            },
        ],
    })
}

async function getPlayinfo(ext) {
    ext = argsify(ext)
    const url = ext.url

    return jsonify({
        urls: [url],
        headers: [{
            'User-Agent': UA,
            'Referer': appConfig.site,
        }],
    })
}

async function search(ext) {
    ext = argsify(ext)
    const text = encodeURIComponent(ext.text)
    const page = ext.page || 1
    const url = appConfig.site + '/cn/search/' + text + '?page=' + page

    const { data } = await fetchPage(url)
    const cards = parseCards(data)

    return jsonify({
        list: cards,
    })
}
