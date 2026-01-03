const SEARCH_PAGE_SIZE = 12;
const SEARCH_COOLDOWN_MS = 1200;

const SEARCH_PROVIDERS = {
    commons: {
        label: 'Wikimedia Commons',
        async search(query, page) {
            const offset = page * SEARCH_PAGE_SIZE;
            const params = new URLSearchParams({
                action: 'query',
                format: 'json',
                origin: '*',
                generator: 'search',
                gsrsearch: query,
                gsrnamespace: '6',
                gsrlimit: String(SEARCH_PAGE_SIZE),
                gsroffset: String(offset),
                prop: 'imageinfo',
                iiprop: 'url|extmetadata',
                iiurlwidth: '420'
            });
            const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`,
                { credentials: 'omit' }
            );
            if (!response.ok) {
                throw new Error(`Wikimedia Commons returned ${response.status}`);
            }
            const data = await response.json();
            const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
            const results = pages.map(pageData => {
                const info = pageData.imageinfo && pageData.imageinfo[0];
                if (!info) {
                    return null;
                }
                const metadata = info.extmetadata || {};
                const licenseShort = metadata.LicenseShortName?.value || '';
                const licenseUrl = metadata.LicenseUrl?.value || '';
                const licenseId = mapCommonsLicense(licenseShort, licenseUrl);
                if (!licenseId || !ALLOWED_LICENSE_IDS.includes(licenseId)) {
                    return null;
                }
                const artist = metadata.Artist?.value || '';
                const title = metadata.ObjectName?.value || pageData.title || '';
                const creator = stripHtml(artist) || 'Wikimedia Commons contributor';
                return {
                    id: `commons-${pageData.pageid}`,
                    provider: 'commons',
                    thumbnailUrl: info.thumburl || info.url,
                    importUrl: info.thumburl || info.url,
                    fullUrl: info.url,
                    sourceUrl: info.descriptionurl || info.url,
                    title: stripHtml(title),
                    creator,
                    creatorUrl: null,
                    licenseId,
                    licenseUrl: licenseUrl || (LICENSES[licenseId] && LICENSES[licenseId].url)
                };
            }).filter(Boolean);

            return {
                results,
                nextPage: results.length === SEARCH_PAGE_SIZE ? page + 1 : null
            };
        }
    },
    openverse: {
        label: 'Openverse',
        async search(query, page) {
            const params = new URLSearchParams({
                q: query,
                license: 'cc0,by,by-sa',
                page: String(page + 1),
                page_size: String(SEARCH_PAGE_SIZE)
            });
            const response = await fetch(`https://api.openverse.engineering/v1/images?${params.toString()}`,
                { credentials: 'omit' }
            );
            if (!response.ok) {
                throw new Error(`Openverse returned ${response.status}`);
            }
            const data = await response.json();
            const results = (data.results || []).map(item => {
                const licenseId = mapOpenverseLicense(item.license, item.license_version);
                if (!licenseId || !ALLOWED_LICENSE_IDS.includes(licenseId)) {
                    return null;
                }
                return {
                    id: `openverse-${item.id}`,
                    provider: 'openverse',
                    thumbnailUrl: item.thumbnail,
                    importUrl: item.thumbnail || item.url,
                    fullUrl: item.url,
                    sourceUrl: item.foreign_landing_url || item.url,
                    title: item.title || 'Openverse image',
                    creator: item.creator || 'Openverse contributor',
                    creatorUrl: item.creator_url || null,
                    licenseId,
                    licenseUrl: item.license_url || (LICENSES[licenseId] && LICENSES[licenseId].url)
                };
            }).filter(Boolean);

            return {
                results,
                nextPage: data.page < data.page_count ? page + 1 : null
            };
        }
    }
};

function stripHtml(text) {
    if (!text) {
        return '';
    }
    const temp = document.createElement('div');
    temp.innerHTML = text;
    return temp.textContent || temp.innerText || '';
}

function mapCommonsLicense(shortName, url) {
    const normalized = (shortName || '').toLowerCase();
    if (normalized.includes('cc0') || normalized.includes('public domain')) {
        return 'CC0-1.0';
    }
    if (normalized.includes('cc-by-sa')) {
        return 'CC-BY-SA-4.0';
    }
    if (normalized.includes('cc-by')) {
        return 'CC-BY-4.0';
    }
    const lowerUrl = (url || '').toLowerCase();
    if (lowerUrl.includes('/zero/1.0')) {
        return 'CC0-1.0';
    }
    if (lowerUrl.includes('/by-sa/4.0')) {
        return 'CC-BY-SA-4.0';
    }
    if (lowerUrl.includes('/by/4.0')) {
        return 'CC-BY-4.0';
    }
    return null;
}

function mapOpenverseLicense(license, version) {
    const normalized = (license || '').toLowerCase();
    if (normalized === 'cc0') {
        return 'CC0-1.0';
    }
    if (normalized === 'by-sa') {
        return 'CC-BY-SA-4.0';
    }
    if (normalized === 'by') {
        return 'CC-BY-4.0';
    }
    if (normalized === 'cc0-1.0') {
        return 'CC0-1.0';
    }
    return null;
}

window.SilentImageSearch = {
    providers: SEARCH_PROVIDERS,
    searchPageSize: SEARCH_PAGE_SIZE,
    cooldownMs: SEARCH_COOLDOWN_MS
};
