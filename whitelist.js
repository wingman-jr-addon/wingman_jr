function isWhitelisted(url) {
    return whitelist_stems.some(stem=>url.startsWith(stem));
}

const whitelist_stems = [
    'https://www.google.com/recaptcha',
    'https://www.gstatic.com/recaptcha'
];