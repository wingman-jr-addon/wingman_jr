function whtIsWhitelisted(url) {
    return whtWhitelistStems.some(stem=>url.startsWith(stem));
}

const whtWhitelistStems = [
    'https://www.google.com/recaptcha',
    'https://www.gstatic.com/recaptcha'
];