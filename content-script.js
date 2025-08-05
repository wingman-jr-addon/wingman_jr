const scoreByUrl = new Map();
let currentSeverity = 0.47;

browser.runtime.onMessage.addListener(msg => {
  if (msg.kind === "score") {
    console.log('Received score '+msg.score+' for '+msg.url);
    const adjustedScore = rocEstimateBalancedScoreAtThreshold(msg.score);
    scoreByUrl.set(msg.url, adjustedScore);
    findAndTint(msg.url, adjustedScore);
  }
});

function getScoreStyle(score) {
    if(score < currentSeverity)
        return '';
    let scaledValue = (score - currentSeverity)/(1.0 - currentSeverity);
    let dropLength = (scaledValue*3)+'px';
    return `filter:blur(${(score - currentSeverity)*20}px) grayscale(${scaledValue}) drop-shadow(red ${dropLength} ${dropLength})`;
}

function getScoreStyleSafe(score) {
    if(score < currentSeverity)
        return '';
    let scaledValue = (score - currentSeverity)/(1.0 - currentSeverity);
    let dropLength = (scaledValue*3)+'px';
    return `filter:blur(${(score - currentSeverity)*30}px) grayscale(${scaledValue}) drop-shadow(red ${dropLength} ${dropLength}) contrast(0.8)`;
}

// will be invoked from the popup/browser-action
async function applyTint() {
  for (const img of document.querySelectorAll("img")) {
    let src = img.currentSrc || img.src;
    const score = scoreByUrl.get(src);
    console.log('Applying tint for '+score+' URL '+ src);
    if (score != null) {
      img.dataset.score = score.toFixed(2);     // optional hook
      img.style.cssText = getScoreStyleSafe(score);
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
    currentSeverity = msg.severity;
    await applyTint();
  }
});