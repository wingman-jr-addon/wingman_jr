async function SMC_readFileAsDataURL (inputFile) {
    const temporaryFileReader = new FileReader();
  
    return new Promise((resolve, reject) => {
        temporaryFileReader.addEventListener("error", function () {
        temporaryFileReader.abort();
        reject(new DOMException("Problem parsing input file."));
      },false);
  
      temporaryFileReader.addEventListener("load", function () {
        resolve(temporaryFileReader.result);
      }, false);
      temporaryFileReader.readAsDataURL(inputFile);
    });
  };

SMC_customUrl = 'https://placehold.co/{width}/{height}';
function SMC_setCustomUrl(customUrl) {
    SMC_customUrl = customUrl;
}

function SMC_getReplacementUrl(vars) {
  return SMC_customUrl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

async function SMC_getReplacementSVG(img, visibleScore) {
    //Originally tried using <image crossorigin="anonymous" href="{url}" ... but it did not work.
    let url = SMC_getReplacementUrl({ width: img.width, height: img.height, visibleScore: visibleScore });
    console.log(`SMC: Creating replacement for image ${img.width}x${img.height} score ${visibleScore} using URL ${url}`);
    let data = await fetch(url);
    let blob = await data.blob();
    let dataUrl = await SMC_readFileAsDataURL(blob);
    let fontSize = Math.round(img.height*0.08);
    let svgText = '<?xml version="1.0" standalone="no"?> <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"   "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"> <svg width="'+img.width+'" height="'+img.height+'" version="1.1"      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    +'<g>'
    + '<image href="'+dataUrl+'" x="0" y="0" height="'+img.height+'px" width="'+img.width+'px" />'
    +' <text transform="translate('+(img.width/2.0)+' '+(img.height/2.0)+')" font-size="'+fontSize+'" fill="grey" opacity="0.35">W'+visibleScore+'</text>'
    +'</g>'
    +'</svg>';
    return svgText;
}