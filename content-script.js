const scoreByUrl = new Map();
browser.runtime.onMessage.addListener(msg => {
  if (msg.kind === "score") {
    console.log('Received score '+msg.score+' for '+msg.url);
    const adjustedScore = rocEstimateBalancedScoreAtThreshold(msg.score);
    scoreByUrl.set(msg.url, adjustedScore);
    findAndTint(msg.url, adjustedScore);
  }
});

// helper to turn the numeric score into a visual style
function styleFor(score) {
  const hue = 120 - score * 120;        // green → red
  const opacity = 0.3 + score * 0.6;    // 0.3 … 0.9
  return `filter:hue-rotate(${hue}deg) opacity(${opacity});`;
}

function styleForMore(score) {
    const opacity = 0.3 + score * 0.6;    // 0.3 … 0.9
    return `filter:grayscale(${Math.sqrt(score)}) opacity(${opacity});`;
}

function styleForMoar(score) {
    const blur = score*10+'px';
    return `filter:grayscale(${Math.sqrt(score)}) blur(${blur});`;
}

// will be invoked from the popup/browser-action
async function applyTint() {
  for (const img of document.querySelectorAll("img")) {
    let src = img.currentSrc || img.src;
    const score = scoreByUrl.get(src);
    console.log('Applying tint for '+score+' URL '+ src);
    if (score != null) {
      img.dataset.score = score.toFixed(2);     // optional hook
      img.style.cssText = styleForMoar(score);
    }
  }
}

function findAndTint(url, score) {
  // exact-match currentSrc/src; expand if you use srcset variants
  const sel = `img[src="${CSS.escape(url)}"]`;
  document.querySelectorAll(sel).forEach(img => applyTint(img, score));
}

document.addEventListener('load', ev => {
  const img = ev.target;
  if (img.tagName !== 'IMG') return;
  const url = img.currentSrc || img.src;
  const score = scoreByUrl.get(url);
  if (score != null) applyTint(img, score);
}, true);           // capture = true  → fires on bubbling edge


// listen for the popup toggle
browser.runtime.onMessage.addListener(async msg => {
  if (msg.kind === "tint") {
    await applyTint();
  }
});