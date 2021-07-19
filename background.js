let backend = 'webgl';
browser.tabs.create({url:`/processor.html?backend=${backend}&id=${backend}-1`, active: false});